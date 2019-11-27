import * as action_core from '@actions/core';
import * as action_github from '@actions/github';
import globby from 'globby';
import * as path from 'path';
import * as fs from 'fs';
import mime from 'mime/lite';
import base64 from 'js-base64';

function getInputAsArray(name: string): string[] {
    return (action_core.getInput(name) || '').split(";").map(v => v.trim()).filter(v => !!v);
}

async function run() {
    try {
        const github_token = (process.env['GITHUB_TOKEN'] || '').trim();
        const preReleasePrefix = (process.env['PRE_RELEASE_PREFIX'] || 'PreRelease-').trim().replace(new RegExp("[ ,:]+", "g"), "-");
        var releaseNotes:string = "";//todo release notes
        // let base64ReleaseNotes = process.env['RELEASE_NOTES_BASE_64'];
        // if (base64ReleaseNotes != null && base64ReleaseNotes.length > 0) {
        //     releaseNotes = base64().decode(process.env['RELEASE_NOTES_BASE_64']);
        // }
        const upload_files_pattern = getInputAsArray('file');
        const is_draft = false; //getInputAsBool('draft');
        const is_prerelease = true; //getInputAsBool('prerelease');
        getInputAsArray('branches');
        const is_verbose = true; //getInputAsBool('verbose');

        if (!github_token) {
            action_core.setFailed("GITHUB_TOKEN is required to upload files");
            return;
        }

        let dateStr = new Date().toLocaleString("RU", {timeZone: "Europe/Moscow"}).replace(new RegExp("[ ,:]+", "g"), "-");
        const TAG_NAME = `${preReleasePrefix}-${action_github.context.ref}__sha-${action_github.context.sha.substr(0, 8)}__${dateStr}`;

        console.log(`TAG_NAME: ${TAG_NAME}`);

        const upload_files = await globby(upload_files_pattern);
        if (!upload_files || upload_files.length <= 0) {
            action_core.setFailed(`Can not find any file by ${upload_files_pattern}`);
            return;
        }
        for (const file_path of upload_files) {
            console.log(`File found to upload: ${file_path}`);
        }

        // request github release
        const octokit = new action_github.GitHub(github_token);

        const pending_to_upload: string[] = [];

        if (is_verbose) {
            console.log("============================= v3 API: createRelease =============================");
        }
        console.log(`Try to create release ${TAG_NAME} for ${action_github.context.repo.owner}/${action_github.context.repo.repo}`);
        let deploy_release = await octokit.repos.createRelease({
            owner: action_github.context.repo.owner,
            repo: action_github.context.repo.repo,
            tag_name: TAG_NAME,
            target_commitish: action_github.context.sha,
            name: TAG_NAME,
            // body: "",
            draft: is_draft,
            prerelease: is_prerelease,
            body: releaseNotes
        });
        let upload_url = deploy_release.data.upload_url;
        let release_url = deploy_release.data.url;
        let release_commitish = deploy_release.data.target_commitish;
        console.log(`Create release ${TAG_NAME} for ${action_github.context.repo.owner}/${action_github.context.repo.repo} success`);
        if (is_verbose) {
            console.log(`createRelease.data = ${JSON.stringify(deploy_release.data)}`);
        }

        if (deploy_release && deploy_release.data && deploy_release.data.assets) {
            const old_asset_map = {};
            for (const asset of deploy_release.data.assets || []) {
                old_asset_map[asset.name] = asset;
            }

            for (const file_path of upload_files) {
                path.basename(file_path);
                pending_to_upload.push(file_path);
            }
        }

        // Upload new assets
        if (is_verbose && pending_to_upload.length > 0) {
            console.log("============================= v3 API: uploadReleaseAsset =============================");
        }
        for (const file_path of pending_to_upload) {
            const file_base_name = path.basename(file_path);
            try {
                console.log(`Uploading asset: ${file_path} ...`);
                const find_mime = mime.getType(path.extname(file_path));
                const upload_rsp = await octokit.repos.uploadReleaseAsset({
                    url: upload_url,
                    headers: {
                        "content-type": find_mime || "application/octet-stream",
                        "content-length": fs.statSync(file_path).size
                    },
                    name: file_base_name,
                    file: fs.createReadStream(file_path)
                });

                if (200 != (upload_rsp.status - upload_rsp.status % 100)) {
                    const msg = `Upload asset: ${file_base_name} failed => ${upload_rsp.headers.status}`;
                    console.log(msg);
                    action_core.setFailed(msg);
                } else {
                    console.log(`Upload asset: ${file_base_name} success`);
                }

                if (is_verbose) {
                    console.log(`uploadReleaseAsset.data = ${JSON.stringify(upload_rsp.data)}`);
                }
            } catch (error) {
                const msg = `Upload asset: ${file_base_name} failed => ${error.message}\r\n${error.stack}`;
                console.log(msg);
                action_core.setFailed(msg)
            }
        }

        action_core.setOutput("release_name", TAG_NAME);
        action_core.setOutput("release_url", release_url);
        action_core.setOutput("release_commitish", release_commitish);
    } catch (error) {
        console.error("catch error: ", error);
        action_core.setFailed(error.message + "\r\n" + error.stack);
    }
}

run();