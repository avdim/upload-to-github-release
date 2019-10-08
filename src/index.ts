import * as action_core from '@actions/core';
import * as action_github from '@actions/github';
import globby from 'globby';
import * as path from 'path';
import * as fs from 'fs';
import mime from 'mime/lite';
import Octokit from '@octokit/rest';

// const io = require('@actions/io');
// const tc = require('@actions/tool-cache');

function getInputAsArray(name: string) : string[] {
    return (action_core.getInput(name) || '').split(";").map(v => v.trim()).filter(v => !!v);
}

function getInputAsBool(name: string) : boolean {
    const res = (action_core.getInput(name) || '').toLowerCase();
    if (!res) {
        return false;
    }

    return res != "false" && res != "disabled" && res != "0" && res != "no" && res != "disable";
}

async function run() {
    try {
        const github_token = (process.env['GITHUB_TOKEN'] || '').trim();
        const upload_files_pattern = getInputAsArray('file');
        const is_overwrite = action_core.getInput('overwrite');
        const is_draft = getInputAsBool('draft');
        const is_prerelease = getInputAsBool('prerelease');
        const with_tags = getInputAsBool('tags');
        const with_branches = getInputAsArray('branches');
        const is_verbose = getInputAsBool('verbose');

        if (typeof (github_token) != 'string') {
            action_core.setFailed("token is invalid");
            return;
        }

        if (!github_token) {
            action_core.setFailed("GITHUB_TOKEN is required to upload files");
            return;
        }

        // action_github.context.eventName = push
        // action_github.context.sha = ae7dc58d20ad51b3c8c37deca1bc07f3ae8526cd
        // context.ref = refs/heads/BRANCH_NAME  or refs/tags/TAG_NAME   
        // action_github.context.ref = refs/heads/master
        // action_github.context.action = xresloaderupload-to-github-release
        // action_github.context.actor = owt5008137
        // action_github.context.repo.repo = upload-to-github-release-test
        // action_github.context.repo.owner = xresloader

        var tag_name = action_github.context.ref.match(/refs\/tags\/(.*)/);
        console.log(`tag_name: ${tag_name}`)
        var release_name = "Release-" + action_github.context.sha.substr(0, 8);
        var release_name_bind_to_tag = false;
        if ((with_branches && with_branches.length > 0) || with_tags) {
            // check branches or tags
            var match_filter = false;
            if (with_tags) {
                const match_tag = action_github.context.ref.match(/refs\/tags\/(.*)/);
                if (match_tag) {
                    match_filter = true;
                    release_name_bind_to_tag = true;
                    release_name = match_tag[1];
                    console.log('Found tag push: ${match_tag[1]}.');
                } else {
                    console.log('Current event is not a tag push.');
                }
            }

            if (!match_filter && (with_branches && with_branches.length > 0)) {
                const match_branch = action_github.context.ref.match(/refs\/heads\/(.*)/);
                if (match_branch) {
                    const selected_branch = with_branches.filter((s) => s == match_branch[1]);
                    if (selected_branch && selected_branch.length > 0) {
                        match_filter = true;
                        release_name = match_branch[1] + '-' + action_github.context.sha.substr(0, 8);
                        console.log('Found branch push: ${match_tag[1]}.');
                    }
                }

                if (!match_filter) {
                    console.log(`Current event is not one of branches [${with_branches.join(", ")}].`);
                }
            }

            if (!match_filter) {
                console.log(`Current event will be skipped.`);
                return;
            }
        } else if (action_github.context.ref) {
            // try get branch name
            const match_branch = action_github.context.ref.match(/([^\/]+)$/);
            if (match_branch && match_branch.length > 1) { 
                release_name = match_branch[1] + '-' + action_github.context.sha.substr(0, 8);
            }
        }

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
        // https://developer.github.com/v3/repos/releases/#upload-a-release-asset
        var deploy_release: Octokit.Response<Octokit.ReposGetReleaseByTagResponse>
            | Octokit.Response<Octokit.ReposCreateReleaseResponse>
            | Octokit.Response<Octokit.ReposUpdateReleaseResponse>
            | undefined = undefined;
        try {
            deploy_release = await octokit.repos.getReleaseByTag({
                owner: action_github.context.repo.owner,
                repo: action_github.context.repo.repo,
                tag: release_name
            });
        } catch (error) {
            console.log(`Try to get release ${release_name} from ${action_github.context.repo.owner}/${action_github.context.repo.repo} : ${error.message}`);
        }

        if (is_verbose) {
            console.log("============================= v3 API: getReleaseByTag =============================");
        }
        if (deploy_release && deploy_release.headers) {
            console.log(`Try to get release ${release_name} from ${action_github.context.repo.owner}/${action_github.context.repo.repo} : ${deploy_release.headers.status}`);
            if (is_verbose) {
                console.log(`getReleaseByTag.data = ${JSON.stringify(deploy_release.data)}`);
            }
        }


        const pending_to_delete : any[] = [];
        const pending_to_upload : string[] = [];
        var upload_url = deploy_release?deploy_release.data.upload_url: "";
        var release_url = deploy_release?deploy_release.data.url: "";
        var release_tag_name = deploy_release?deploy_release.data.tag_name: "";
        var release_commitish = deploy_release?deploy_release.data.target_commitish: "";
        // https://developer.github.com/v3/repos/releases/#create-a-release
        if (deploy_release && deploy_release.data) {
            try {
                if (is_verbose) {
                    console.log("============================= v3 API: updateRelease =============================");
                }
                console.log(`Try to update release ${release_name} for ${action_github.context.repo.owner}/${action_github.context.repo.repo}`);
                deploy_release = await octokit.repos.updateRelease({
                    owner: action_github.context.repo.owner,
                    repo: action_github.context.repo.repo,
                    release_id: deploy_release.data.id,
                    tag_name: release_name,
                    target_commitish: release_name_bind_to_tag? undefined: action_github.context.sha,
                    name: release_name,
                    body: deploy_release.data.body || undefined,
                    draft: is_draft,
                    prerelease: is_prerelease
                });
                upload_url = deploy_release.data.upload_url;
                release_url = deploy_release.data.url;
                release_tag_name = deploy_release.data.tag_name;
                release_commitish = deploy_release.data.target_commitish;
                console.log(`Update release ${release_name} for ${action_github.context.repo.owner}/${action_github.context.repo.repo} success`);
                if (is_verbose) {
                    console.log(`updateRelease.data = ${JSON.stringify(deploy_release.data)}`);
                }
            } catch (error) {
                var msg = `Try to update release ${release_name} for ${action_github.context.repo.owner}/${action_github.context.repo.repo} failed: ${error.message}`;
                msg += `\r\n${error.stack}`;
                console.log(msg);
                action_core.setFailed(msg);
            }
        } else {
            try {
                if (is_verbose) {
                    console.log("============================= v3 API: createRelease =============================");
                }
                console.log(`Try to create release ${release_name} for ${action_github.context.repo.owner}/${action_github.context.repo.repo}`);
                deploy_release = await octokit.repos.createRelease({
                    owner: action_github.context.repo.owner,
                    repo: action_github.context.repo.repo,
                    tag_name: release_name,
                    target_commitish: release_name_bind_to_tag? undefined: action_github.context.sha,
                    name: release_name,
                    // body: "",
                    draft: is_draft,
                    prerelease: is_prerelease
                });
                upload_url = deploy_release.data.upload_url;
                release_url = deploy_release.data.url;
                release_tag_name = deploy_release.data.tag_name;
                release_commitish = deploy_release.data.target_commitish;
                console.log(`Create release ${release_name} for ${action_github.context.repo.owner}/${action_github.context.repo.repo} success`);
                if (is_verbose) {
                    console.log(`createRelease.data = ${JSON.stringify(deploy_release.data)}`);
                }
            } catch (error) {
                var msg = `Try to create release ${release_name} for ${action_github.context.repo.owner}/${action_github.context.repo.repo} failed: ${error.message}`;
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
        action_core.setOutput("release_name", release_name);
        action_core.setOutput("release_url", release_url);
        action_core.setOutput("release_tag_name", release_tag_name);
        action_core.setOutput("release_commitish", release_commitish);
    } catch (error) {
        action_core.setFailed(error.message + "\r\n" + error.stack);
    }
}

run();