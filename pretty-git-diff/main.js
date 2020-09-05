const parser = require('gitdiff-parser');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");
const { exec } = require('child_process');
const fs = require('fs');
const { trim, flatten } = require('lodash');

async function execShellCommand(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.warn(error);
            }
            resolve(stdout ? stdout : stderr);
        });
    });
}

async function getCommmits() {
    const oneLineCommits = await execShellCommand('git log --oneline');
    return oneLineCommits.split('\n').map((line) => {
        const lineFragments = line.split(' ');
        const sha1 = lineFragments[0];
        const message = lineFragments[1];
        return {
            sha1,
            message,
        };
    });
}

(async function () {
    const dir = process.argv[2];
    process.chdir(dir);
    const commits = await getCommmits();
    const doc = new Document();
    const diffAndMessages = await Promise.all(commits.map(async (commit) => {
        const diffString = await execShellCommand(`git show ${commit.sha1}`);
        const diff = parser.parse(diffString);
        return {
            diff,
            ...commit,
        };
    }));
    diffAndMessages.forEach((commit) => {
        const children = [];
        children.push(new Paragraph({
            text: commit.message,
            heading: HeadingLevel.HEADING_1,
        }));
        children.push(flatten(commit.diff.map((diff) => {
            if (diff.hunks.length === 0) {
                // 非文本文件的变动 hunks 为 0
                return [];
            }
            const hunks = diff.hunks.map((hunk, index, hunks) => {
                const changes = hunk.changes.map((change) => {
                    const content = change.content;
                    const space = (content.match(/^\s+/) || [''])[0];
                    const noSpace = trim(content);
                    const spaceText = new TextRun(space);
                    const noSpaceText = new TextRun({
                        text: noSpace,
                        bold: change.type === 'insert',
                        strike: change.type === 'delete',
                    });
                    const paragraph = new Paragraph({
                        children: [spaceText, noSpaceText],
                    });
                    return paragraph;
                });
                if (index < hunks.length - 1) {
                    changes.push(new Paragraph('...'));
                }
                return changes;
            });
            return [
                new Paragraph({
                    text: `// ${diff.newPath}`,
                }),
                ...flatten(hunks),
                new Paragraph(''),
            ]
        })));
        doc.addSection({
            children: flatten(children),
        });
    });
    Packer.toBuffer(doc).then((buffer) => {
        fs.writeFileSync("code.docx", buffer);
    });
})();
