import * as action_core from '@actions/core';
import * as action_github from '@actions/github';
import globby from 'globby';
import * as path from 'path';
import * as fs from 'fs';
import mime from 'mime/lite';
import Octokit from '@octokit/rest';

function getInputAsArray(name: string) : string[] {
    return (action_core.getInput(name) || '').split(";").map(v => v.trim()).filter(v => !!v);
}

async function run() {
    let msg;
    try {
        const github_token = (process.env['GITHUB_TOKEN'] || '').trim();
        const upload_files_pattern = getInputAsArray('file');
        const is_overwrite = false ;//action_core.getInput('overwrite');
        const is_draft = false; //getInputAsBool('draft');
        const is_prerelease = false; //getInputAsBool('prerelease');
        getInputAsArray('branches');
        const is_verbose = true; //getInputAsBool('verbose');

        if (!github_token) {
            action_core.setFailed("GITHUB_TOKEN is required to upload files");
            return;
        }

        const match_tag = action_github.context.ref.match(/refs\/tags\/(.*)/);
        if(match_tag == null) {
            console.error(`unknown tag ${action_github.context.ref}`);
            return;
        }
        const TAG_NAME = match_tag[1];
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
        /** Can not upload assets by v4 API, so we use v3 API by now **/
        /**
         // Debug Tool: https://developer.github.com/v4/explorer
         // API Docs:   https://developer.github.com/v4/
         const repo_info = await octokit.graphql(`query {
            repository (owner:"xresloader", name:"xresloader") {
                release (tagName: "v2.5.0") {
                id,
                name,
                isDraft,
                resourcePath,
                tag {
                    id,
                    name,
                    prefix
                },
                updatedAt,
                url,
                releaseAssets(last: 5) {
                    nodes {
                    id,
                    name,
                    size,
                    downloadUrl
                    }
                }
                }
            }
        }`);

         const repo_info_of_release = await octokit.graphql(`query {
            repository (owner:"${action_github.context.repo.owner}", name:"${action_github.context.repo.repo}") {
                release (tagName: "${release_name}") {
                id,
                name,
                isDraft,
                resourcePath,
                tag {
                    id,
                    name,
                    prefix
                },
                updatedAt,
                url,
                releaseAssets(last: 5) {
                    nodes {
                    id,
                    name,
                    size,
                    downloadUrl
                    }
                }
                }
            }
        }`);

         console.log("============================= v4 API: graphql(query {repository}) =============================");
         console.log(`repo_info = ${JSON.stringify(repo_info)}`);
         console.log(`repo_info_of_release = ${JSON.stringify(repo_info_of_release)}`);
         **/
        let deploy_release: Octokit.Response<Octokit.ReposGetReleaseByTagResponse>
            | Octokit.Response<Octokit.ReposCreateReleaseResponse>
            | Octokit.Response<Octokit.ReposUpdateReleaseResponse>
            | undefined = undefined;
        try {
            deploy_release = await octokit.repos.getReleaseByTag({
                owner: action_github.context.repo.owner,
                repo: action_github.context.repo.repo,
                tag: TAG_NAME
            });
        } catch (error) {
            console.log(`Try to get release ${TAG_NAME} from ${action_github.context.repo.owner}/${action_github.context.repo.repo} : ${error.message}`);
        }

        if (is_verbose) {
            console.log("============================= v3 API: getReleaseByTag =============================");
        }
        if (deploy_release && deploy_release.headers) {
            console.log(`Try to get release ${TAG_NAME} from ${action_github.context.repo.owner}/${action_github.context.repo.repo} : ${deploy_release.headers.status}`);
            if (is_verbose) {
                console.log(`getReleaseByTag.data = ${JSON.stringify(deploy_release.data)}`);
            }
        }


        const pending_to_delete : any[] = [];
        const pending_to_upload : string[] = [];
        let upload_url = deploy_release ? deploy_release.data.upload_url : "";
        let release_url = deploy_release ? deploy_release.data.url : "";
        // var release_tag_name = deploy_release?deploy_release.data.tag_name: "";
        let release_commitish = deploy_release ? deploy_release.data.target_commitish : "";
        // https://developer.github.com/v3/repos/releases/#create-a-release
        if (deploy_release && deploy_release.data) {
            try {
                if (is_verbose) {
                    console.log("============================= v3 API: updateRelease =============================");
                }
                console.log(`Try to update release ${TAG_NAME} for ${action_github.context.repo.owner}/${action_github.context.repo.repo}`);
                deploy_release = await octokit.repos.updateRelease({
                    owner: action_github.context.repo.owner,
                    repo: action_github.context.repo.repo,
                    release_id: deploy_release.data.id,
                    tag_name: TAG_NAME,
                    name: TAG_NAME,
                    body: deploy_release.data.body || undefined,
                    draft: is_draft,
                    prerelease: is_prerelease
                });
                upload_url = deploy_release.data.upload_url;
                release_url = deploy_release.data.url;
                release_commitish = deploy_release.data.target_commitish;
                console.log(`Update release ${TAG_NAME} for ${action_github.context.repo.owner}/${action_github.context.repo.repo} success`);
                if (is_verbose) {
                    console.log(`updateRelease.data = ${JSON.stringify(deploy_release.data)}`);
                }
            } catch (error) {
                msg = `Try to update release ${TAG_NAME} for ${action_github.context.repo.owner}/${action_github.context.repo.repo} failed: ${error.message}`;
                msg += `\r\n${error.stack}`;
                console.log(msg);
                action_core.setFailed(msg);
            }
        } else {
            try {
                if (is_verbose) {
                    console.log("============================= v3 API: createRelease =============================");
                }
                console.log(`Try to create release ${TAG_NAME} for ${action_github.context.repo.owner}/${action_github.context.repo.repo}`);
                deploy_release = await octokit.repos.createRelease({
                    owner: action_github.context.repo.owner,
                    repo: action_github.context.repo.repo,
                    tag_name: TAG_NAME,
                    name: TAG_NAME,
                    // body: "",
                    draft: is_draft,
                    prerelease: is_prerelease
                });
                upload_url = deploy_release.data.upload_url;
                release_url = deploy_release.data.url;
                release_commitish = deploy_release.data.target_commitish;
                console.log(`Create release ${TAG_NAME} for ${action_github.context.repo.owner}/${action_github.context.repo.repo} success`);
                if (is_verbose) {
                    console.log(`createRelease.data = ${JSON.stringify(deploy_release.data)}`);
                }
            } catch (error) {
                msg = `Try to create release ${TAG_NAME} for ${action_github.context.repo.owner}/${action_github.context.repo.repo} failed: ${error.message}`;
                msg += `\r\n${error.stack}`;
                console.log(msg);
                action_core.setFailed(msg);
            }
        }

        if (deploy_release && deploy_release.data && deploy_release.data.assets) {
            const old_asset_map = {};
            for (const asset of deploy_release.data.assets || []) {
                old_asset_map[asset.name] = asset;
            }

            for (const file_path of upload_files) {
                const file_base_name = path.basename(file_path);
                if (old_asset_map[file_base_name]) {
                    if (is_overwrite) {
                        pending_to_delete.push(old_asset_map[file_base_name]);
                        pending_to_upload.push(file_path);
                    } else {
                        console.log(`Skip asset file: ${file_base_name}, it'salready existed.`);
                    }
                } else {
                    pending_to_upload.push(file_path);
                }
            }
        }

        // Delete old assets.
        if (is_verbose && pending_to_delete.length > 0) {
            console.log("============================= v3 API: deleteReleaseAsset =============================");
        }
        for (const asset of pending_to_delete) {
            try {
                // const pick_id = Buffer.from(asset.id, 'base64').toString().match(/\d+$/); // convert id from graphql v4 api to v3 rest api
                console.log(`Deleting old asset: ${asset.name} ...`);
                const delete_rsp = await octokit.repos.deleteReleaseAsset({
                    owner: action_github.context.repo.owner,
                    repo: action_github.context.repo.repo,
                    asset_id: asset.id
                });
                console.log(`Delete old asset: ${asset.name} => ${delete_rsp.headers.status}`);
            } catch (error) {
                const msg = `Delete old asset: ${asset.name} failed => ${error.message}`;
                console.log(msg);
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

        // Environment sample
        // GITHUB_ACTION=run
        // GITHUB_ACTIONS=true
        // GITHUB_ACTOR=owt5008137
        // GITHUB_BASE_REF=
        // GITHUB_EVENT_NAME=push
        // GITHUB_EVENT_PATH=/home/runner/work/_temp/_github_workflow/event.json
        // GITHUB_HEAD_REF=
        // GITHUB_REF=refs/heads/master
        // GITHUB_REPOSITORY=xresloader/upload-to-github-release-test
        // GITHUB_SHA=d3e5b42d6fdf7bfab40c5d6d7d51491d0287780f
        // GITHUB_WORKFLOW=main
        // GITHUB_WORKSPACE=/home/runner/work/upload-to-github-release-test/upload-to-github-release-test
        // set output
        action_core.setOutput("release_name", TAG_NAME);
        action_core.setOutput("release_url", release_url);
        action_core.setOutput("release_commitish", release_commitish);
    } catch (error) {
        action_core.setFailed(error.message + "\r\n" + error.stack);
    }
}

run();