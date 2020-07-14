const {Octokit} = require('@octokit/rest');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

String.prototype.leftTrim = function () {
    return this.replace(/^\s+/, "");
};

String.prototype.rightTrim = function () {
    return this.replace(/\s+$/, "");
};

String.prototype.replaceMarkdownSection = function (headline, replacement, append = false) {
    let indexOfHeadline = this.indexOf('# ' + headline);
    let indexOfSection = this.length - 1;
    let indexOfNextSection = this.length - 1;

    if (indexOfHeadline === -1 && append === false) {
        return this;
    }

    if (indexOfHeadline !== -1) {
        indexOfSection = this.substr(0, indexOfHeadline).lastIndexOf('\n');
        indexOfNextSection = this.indexOf('\n#', indexOfHeadline);
    }

    return (this.substr(0, indexOfSection).rightTrim() + '\n\n' + replacement.trim() + '\n\n' + this.substr(indexOfNextSection).leftTrim()).trim() + '\n';
};

const octokit = new Octokit({auth: process.env.GITHUB_API_KEY});

function repos(page = 1) {
    return new Promise((resolve) => {
        octokit.repos.listForOrg({org: 'Astrotomic', per_page: 100, page}).then(async (response) => {
            let repositories = response.data
                .filter(repo => !repo.private)
                .filter(repo => !repo.archived)
                .filter(repo => repo.name !== '.github')
                .filter(repo => repo.name !== 'art')
            ;

            if (response.data.length === 100) {
                repositories = repositories.concat(await repos(page + 1));
            }

            resolve(repositories);
        });
    });
}

function deleteFile(repo, filepath) {
    return octokit.repos.getContent({
        owner: repo.owner.login,
        repo: repo.name,
        path: filepath,
        ref: repo.default_branch,
    }).then(response => {
        return octokit.repos.deleteFile({
            owner: repo.owner.login,
            repo: repo.name,
            path: response.data.path,
            message: `delete ${response.data.name} to use https://github.com/Astrotomic/.github one`,
            sha: response.data.sha,
            branch: repo.default_branch,
            author: {
                name: 'Gummibeer',
                email: '6187884+Gummibeer@users.noreply.github.com',
            }
        });
    }).catch(() => true);
}

function updateFile(repo, filepath, callback, message = null) {
    let newContent = false;
    let sha = null;

    return octokit.repos.getContent({
        owner: repo.owner.login,
        repo: repo.name,
        path: filepath,
        ref: repo.default_branch,
    })
        .then(response => {
            let content = Buffer.from(response.data.content, 'base64').toString();
            newContent = Buffer.from(callback(content)).toString();
            sha = response.data.sha;

            if (!newContent || content === newContent) {
                newContent = false;
            }
        })
        .catch(() => {
            newContent = callback('');
        })
        .finally(async () => {
            if (!newContent) {
                return;
            }

            console.log(`create or update file: ${repo.owner.login}/${repo.name}@${filepath}`);
            await octokit.repos.createOrUpdateFileContents({
                owner: repo.owner.login,
                repo: repo.name,
                path: filepath,
                message: message ?? `Update ${filepath}`,
                content: Buffer.from(newContent).toString('base64'),
                branch: repo.default_branch,
                sha: sha,
                author: {
                    name: 'Gummibeer',
                    email: '6187884+Gummibeer@users.noreply.github.com',
                }
            }).catch(console.error);
        });
}

function updateReadme(repo, callback) {
    return updateFile(repo, 'README.md', readme => callback(readme).trim() + '\n');
}

function updateTreeware(repo) {
    return updateReadme(repo, readme => {
        let treeware = fs.readFileSync(path.resolve(__dirname, '..', 'TREEWARE.md')).toString()
            .replace('{owner}', repo.owner.login)
            .replace('{repo}', repo.name);
        return readme.replaceMarkdownSection('Treeware', treeware, true);
    });
}

async function updateContributing(repo) {
    await updateReadme(repo, readme => {
        let replacement = '## Contributing\n\nPlease see [CONTRIBUTING](https://github.com/Astrotomic/.github/blob/master/CONTRIBUTING.md) for details. You could also be interested in [CODE OF CONDUCT](https://github.com/Astrotomic/.github/blob/master/CODE_OF_CONDUCT.md).';
        return readme.replaceMarkdownSection('Contributing', replacement);
    });
    await updateReadme(repo, readme => {
        let replacement = '### Security\n\nIf you discover any security related issues, please check [SECURITY](https://github.com/Astrotomic/.github/blob/master/SECURITY.md) for steps to report it.';
        return readme.replaceMarkdownSection('Security', replacement);
    });
}

async function updateLabels(repo)
{
    const labels = {
        'stale': 'ffffff',
        'bug': 'FC8181',
        'documentation': 'A3BFFA',
        'duplicate': 'E2E8F0',
        'enhancement': 'B2F5EA',
        'good first issue': 'D6BCFA',
        'help wanted': '9AE6B4',
        'invalid': 'E2E8F0',
        'next major release': 'FBD38D',
        'next release': 'FAF089',
        'question': 'FBB6CE',
        'wontfix': 'ffffff',
        'dependencies': '0366d6',
        'hacktoberfest': 'ffffff',
    };

    for(let name in labels) {
        let data = {
            owner: repo.owner.login,
            repo: repo.name,
            name: name,
            color: labels[name],
            description: '',
        };

        await octokit.issues.updateLabel(data).catch(() => octokit.issues.createLabel(data));
    }
}

repos().then(repos => {
    return repos.forEach(async repo => {
        await updateLabels(repo);

        // delete all inherited files
        await deleteFile(repo, '.github/FUNDING.yml');
        await deleteFile(repo, 'CODE_OF_CONDUCT.md');
        await deleteFile(repo, 'CONTRIBUTING.md');
        await deleteFile(repo, 'SECURITY.md');
        await deleteFile(repo, 'SUPPORT.md');

        // copy shared github actions
        fs.readdirSync(path.resolve(__dirname, '..', 'workflows', 'shared')).forEach(async filename => {
            await updateFile(repo, `.github/workflows/${filename}`, () => fs.readFileSync(path.resolve(__dirname, '..', 'workflows', 'shared', filename)));
        });

        // update readme sections
        await updateTreeware(repo);
        await updateContributing(repo);
    });
});
