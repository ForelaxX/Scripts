const parser = require('gitdiff-parser');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { trim, flatten, first, last } = require('lodash');

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
    const output = process.argv[3];
    process.chdir(dir);
    const commits = await getCommmits();
    const doc = new Document({
        styles: {
            paragraphStyles: [
                {
                    id: "Code",
                    name: "程序",
                    basedOn: "Normal",
                    next: "Code",
                    quickFormat: true,
                    run: {
                        size: 16,
                    },
                },
            ],
        }
    });
    const diffAndMessages = await Promise.all(commits.map(async (commit) => {
        const diffString = await execShellCommand(`git show ${commit.sha1}`);
        const diff = parser.parse(diffString);
        return {
            diff,
            ...commit,
        };
    }));
    diffAndMessages.reverse().forEach((commit) => {
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
                    const spaceText = new TextRun({
                        text: space,
                        style: 'Code',
                    });
                    const noSpaceText = new TextRun({
                        text: noSpace,
                        bold: change.type === 'insert',
                        strike: change.type === 'delete',
                        style: 'Code',
                    });
                    const paragraph = new Paragraph({
                        children: [spaceText, noSpaceText],
                        style: 'Code',
                    });
                    return paragraph;
                });
                if (index < hunks.length - 1) {
                    // 如果不是最后一个 hunk，就加一个 ...
                    changes.push(new Paragraph({
                        text: '...',
                        style: 'Code',
                    }));
                }
                return changes;
            });
            return [
                new Paragraph({
                    text: `// ${diff.newPath}`,
                    style: 'Code',
                }),
                // 如果没有从开头开始的，加个 ...
                (first(diff.hunks).oldStart === 1 || first(diff.hunks).oldStart === 1) ? undefined : new Paragraph({
                    text: '...',
                    style: 'Code',
                }),
                ...flatten(hunks),
                // 简单的判断，如果以空行开头，说明不是最后一行，下方加个 ...
                last(last(diff.hunks).changes).content.startsWith(' ') ? undefined : new Paragraph({
                    text: '...',
                    style: 'Code',
                }),
                // 空行
                new Paragraph({
                    text: '',
                    style: 'Code',
                }),
            ]
        })));
        doc.addSection({
            children: flatten(children),
        });
    });
    Packer.toBuffer(doc).then((buffer) => {
        fs.writeFileSync(path.join(`${output}`, 'code.docx'), buffer);
    });
})();
