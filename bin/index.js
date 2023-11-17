#! /usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const figlet_1 = __importDefault(require("figlet"));
const chalk_1 = __importDefault(require("chalk"));
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const simple_git_1 = __importDefault(require("simple-git"));
const readline_1 = __importDefault(require("readline"));
const xml2js_1 = require("xml2js");
const os_1 = __importDefault(require("os"));
const platform = os_1.default.platform();
const program = new commander_1.Command();
const git = (0, simple_git_1.default)({ baseDir: path_1.default.dirname("./") });
const rl = readline_1.default.createInterface({
    input: process.stdin,
    output: process.stdout,
});
let mvn = "./mvnw";
if (platform === 'win32') {
    mvn = "./mvnw.cmd";
}
program.name(chalk_1.default.green("Xstarva Devtools CLI"));
program
    .command("build")
    .description("build project locally")
    .option("--skip-tests", "skips compiling the tests")
    .option("-p, --profiles <profiles>", "active profiles")
    .option("--debug", "build with debug")
    .action((options) => {
    var _a;
    try {
        if (options.skipTests) {
            console.log(chalk_1.default.blue("-> Building project with skip tests..."));
        }
        else {
            console.log(chalk_1.default.blue("-> Building project..."));
        }
        const command = mvn + ` clean install -s .settings.xml ${options.skipTests ? "-DskipTests" : ""} ${options.profiles ? "-P " + options.profiles : ""}  ${options.debug ? "--debug" : ""}`;
        const childProcess = (0, child_process_1.exec)(command, (error, stdout, stderr) => {
            if (error) {
                console.error(chalk_1.default.red(`-> Error during build locally: ${stderr}`));
            }
        });
        (_a = childProcess.stdout) === null || _a === void 0 ? void 0 : _a.on("data", (log) => {
            console.log(chalk_1.default.green(log));
        });
    }
    catch (error) {
        console.error(chalk_1.default.red("-> Error during build locally", error.message));
        process.exit(1);
    }
});
program
    .command("publish <type>")
    .description("publish to gitlab package registry")
    .option("-t, --tag", "tag version gitlab")
    .option("--bump", "bump version")
    .action((type, options) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const typeAllowPublish = ["SNAPSHOT", "RC", "RELEASE"];
        if (!typeAllowPublish.includes(type.trim().toUpperCase())) {
            console.error(chalk_1.default.red(`-> Unsupported publish type '${type}', please choose 'SNAPSHOT', 'RC' or 'RELEASE'`));
            process.exit(1);
        }
        const tag = options.tag;
        const bumpVersion = options.bump;
        const parentPomPath = "./pom.xml";
        const version = (yield parseParentPom(fs_1.default.readFileSync(parentPomPath, "utf-8"), parentPomPath, type));
        const versionItem = version.split(".");
        let nextVersion = versionItem[0] +
            "." +
            versionItem[1] +
            "." +
            (parseInt(versionItem[2]) + 1);
        const branch = (yield getCurrentGitBranch());
        console.log(chalk_1.default.blue(`-> Processing publish to gitlab registry with version: ${version}-${type}`));
        console.log(chalk_1.default.blue(`-> Git fetch`));
        yield git.fetch((err, update) => {
            if (err) {
                console.error(chalk_1.default.red("-> Error during git fetch:"), err);
                process.exit(1);
            }
            else {
                console.log(chalk_1.default.green("-> Git fetch successful"));
            }
        });
        console.log(chalk_1.default.blue(`-> Git pull rebase \`origin\` main branch`));
        yield git.pull("origin", branch, ["--rebase"], (err, update) => {
            if (err) {
                console.error(chalk_1.default.red("-> Error during git pull rebase origin main:"), err);
                process.exit(1);
            }
            else {
                console.log(chalk_1.default.green("-> Git pull rebase origin main successful"));
            }
        });
        console.log(chalk_1.default.blue(`-> Git checkout \`${branch}\` branch`));
        yield git.checkout(branch, (err) => {
            if (err) {
                console.error(chalk_1.default.red(`-> Error during git checkout \`${branch}\` branch:`), err);
                process.exit(1);
            }
            else {
                console.log(chalk_1.default.green(`-> Checked out \`${branch}\``));
            }
        });
        console.log(chalk_1.default.blue(`-> Git rebase main branch`));
        yield git.rebase([branch], (err) => {
            if (err) {
                console.error(chalk_1.default.red("-> Error during git rebase main branch:"), err);
                process.exit(1);
            }
            else {
                console.log(chalk_1.default.green(`-> Rebase onto ${branch} completed`));
            }
        });
        console.log(chalk_1.default.green(`-> Newest code updated`));
        if (branch == "main") {
            if (type.endsWith("RELEASE") || type.endsWith("RC")) {
                yield updateVersion(version, type, fs_1.default.readFileSync(parentPomPath, "utf-8"), parentPomPath);
                yield buildLocallyAndPublish();
                yield pushCodeUpdatedVersion(version + "-" + type, branch);
                if (tag) {
                    yield tagReleaseVersion(version + "-" + type);
                }
                else {
                    console.warn(chalk_1.default.yellow(`-> Skipping to tag version`));
                }
                if (!bumpVersion || type.endsWith("RC")) {
                    process.exit(1);
                }
                yield updateVersion(nextVersion, "SNAPSHOT", fs_1.default.readFileSync(parentPomPath, "utf-8"), parentPomPath);
                yield pushCodeUpdatedVersion(nextVersion + "-SNAPSHOT", branch);
                process.exit(1);
            }
            else {
                console.error(chalk_1.default.red(`-> Invalid publish version type \`${type}\` for current branch is \`${branch}\`, please choose \`RC\` or \`RELEASE\``));
                process.exit(1);
            }
        }
        else if (/^\d+\.\d+\.x+$/.test(branch)) {
            if (type.endsWith("SNAPSHOT")) {
                yield updateVersion(version, type, fs_1.default.readFileSync(parentPomPath, "utf-8"), parentPomPath);
                yield buildLocallyAndPublish();
                yield pushCodeUpdatedVersion(version + "-" + type, branch);
                process.exit(1);
            }
            else {
                console.error(chalk_1.default.red(`-> Invalid publish version type \`${type}\` for current branch is \`${branch}\`, please choose \`SNAPSHOT\``));
                process.exit(1);
            }
        }
        else {
            console.log(chalk_1.default.red(`-> Publishing on \`non-build\` or \`main\` branches is not supported. Please checkout to build branch (ex: 1.0.x) or main branch to publish`));
            process.exit(1);
        }
    }
    catch (error) {
        console.error(chalk_1.default.red("Error during publish:", error.message));
        process.exit(1);
    }
}));
function askForPublish(defaultNumberVersion, publishType) {
    return new Promise((resolve) => {
        rl.question(`-> Enter publish version ` +
            chalk_1.default.grey(`(default version ${defaultNumberVersion})`) +
            `: `, (answer) => {
            const versionPattern = /^\d+\.\d+\.\d+$/;
            if (answer &&
                !(answer == "") &&
                !versionPattern.test(answer.trim().toUpperCase())) {
                console.warn(chalk_1.default.yellow(`-> Invalid version. Please re-enter a valid version`));
                resolve(askForPublish(defaultNumberVersion, publishType));
            }
            else {
                resolve((answer ? answer.trim().toUpperCase() : answer) ||
                    `${defaultNumberVersion}`);
            }
        });
    });
}
function parseParentPom(parentPomContent, parentPomPath, type) {
    return new Promise((resolve, reject) => {
        (0, xml2js_1.parseString)(parentPomContent, (parseErr, parentResult) => __awaiter(this, void 0, void 0, function* () {
            if (parseErr) {
                console.error(chalk_1.default.red(`-> Error parsing POM file \`${parentPomPath}\``));
                reject(parseErr);
                process.exit(1);
            }
            const version = parentResult.project.version[0];
            if (!version) {
                console.error(`-> No project version found in parent POM file.`);
                reject(new Error("No project version found in parent POM file."));
                return;
            }
            let numberVersion = version.split("-")[0];
            try {
                const result = yield askForPublish(numberVersion, type);
                resolve(result);
            }
            catch (askForPublishErr) {
                reject(askForPublishErr);
                process.exit(1);
            }
        }));
    });
}
function getCurrentGitBranch() {
    return new Promise((resolve, reject) => {
        git.branch([], (err, summary) => {
            if (err) {
                console.error(chalk_1.default.red(`-> Error getting current branch`));
                reject(err);
                process.exit(1);
            }
            const currentBranch = summary.current;
            resolve(currentBranch);
        });
    });
}
function updateVersion(version, type, parentPomContent, parentPomPath) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(chalk_1.default.blue(`-> Updating POM project version: ${version}-${type}`));
        (0, xml2js_1.parseString)(parentPomContent, (parseErr, parentResult) => {
            if (parseErr) {
                console.error(chalk_1.default.red(`-> Error parsing ${parentPomPath}:`), parseErr);
                process.exit(1);
            }
            const parentVersion = parentResult.project.version[0];
            if (parentVersion != `${version}-${type}`) {
                findAndReplaceVersionInPom(parentPomPath, parentVersion, `${version}-${type}`);
                const modules = parentResult.project.modules
                    ? parentResult.project.modules[0].module
                    : [];
                for (const moduleName of modules) {
                    const childPomPath = path_1.default.join(path_1.default.dirname(parentPomPath), moduleName, "pom.xml");
                    findAndReplaceVersionInPom(childPomPath, parentVersion, `${version}-${type}`);
                }
                console.log(chalk_1.default.green(`-> Updated project version successful`));
            }
            else {
                console.log(chalk_1.default.green(`-> Updated project version successful`));
            }
        });
    });
}
function findAndReplaceVersionInPom(filePath, targetText, replacementText) {
    const pomContent = fs_1.default.readFileSync(filePath, "utf-8");
    (0, xml2js_1.parseString)(pomContent, (parseErr, result) => {
        if (parseErr) {
            console.error(chalk_1.default.red(`-> Error parsing ${filePath}:`), parseErr);
            return;
        }
        if (JSON.stringify(result).includes(targetText)) {
            const updatedContent = pomContent.replace(new RegExp(targetText, "g"), replacementText);
            fs_1.default.writeFileSync(filePath, updatedContent, "utf-8");
            console.log(chalk_1.default.green(`-> ${filePath}: Updated project & parent version \`${targetText}\` to \`${replacementText}\``));
        }
        else {
            console.log(chalk_1.default.yellow(`-> ${filePath}: Project or parent version \`${targetText}\` not found`));
        }
    });
}
function buildLocallyAndPublish() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(chalk_1.default.blue("-> Build & publish to package registry..."));
        try {
            const command = mvn + ` clean deploy -s .settings.xml`;
            (0, child_process_1.exec)(command, (error, stdout, stderr) => {
                if (error) {
                    console.error(chalk_1.default.red(`-> Error during publish to package registry`));
                    process.exit(1);
                }
            });
            console.log(chalk_1.default.green("-> Publish to package registry successful"));
        }
        catch (error) {
            console.error(chalk_1.default.red("-> Error during publish to package registry"));
            process.exit(1);
        }
    });
}
function pushCodeUpdatedVersion(version, branch) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(chalk_1.default.blue(`-> Processing to commit version updated...`));
        yield gitAddChanges();
        yield git.commit(`Update version to ${version}`, (err) => {
            if (err) {
                console.error(chalk_1.default.red("-> Error during git commit version updated", err));
                process.exit(1);
            }
            else {
                console.log(chalk_1.default.green("-> Git commit version updated"));
            }
        });
        console.log(chalk_1.default.blue(`-> Processing to push version updated...`));
        yield git.push("origin", branch, [], (err) => {
            if (err) {
                console.error(chalk_1.default.red("-> Error during git push version updated"));
                process.exit(1);
            }
            else {
                console.log(chalk_1.default.green("-> Git push version updated successful"));
            }
        });
    });
}
function tagReleaseVersion(version) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(chalk_1.default.blue(`-> Tagging version ${version}`));
        yield git.addAnnotatedTag(`v` + version, `Release version v${version}`, (err, tag) => {
            if (err) {
                console.error(chalk_1.default.red("-> Error during git tag"));
                process.exit(1);
            }
            else {
                console.log(chalk_1.default.green(`-> Git tag added: v${version}`));
                git.pushTags("origin", [], (err) => {
                    if (err) {
                        console.error(chalk_1.default.red("-> Error during git push tags"));
                        process.exit(1);
                    }
                    else {
                        console.log(chalk_1.default.green("-> Tags pushed to the remote repository"));
                    }
                });
            }
        });
    });
}
function pushCodeGoBackVersion(version, branch) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(chalk_1.default.blue(`-> Processing to go back snapshot version after release...`));
        yield gitAddChanges();
        yield git.commit(`Go back ${version}-SNAPSHOT`, (err) => {
            if (err) {
                console.error(chalk_1.default.red("-> Error during git commit go back snapshot:", err));
                process.exit(1);
            }
            else {
                console.log(chalk_1.default.green("-> Git commit go back snapshot successful"));
            }
        });
        console.log(chalk_1.default.blue(`-> Processing push go back snapshot version...`));
        yield git.push("origin", branch, [], (err) => {
            if (err) {
                console.error(chalk_1.default.red("-> Error during git push go back snapshot:"), err);
                process.exit(1);
            }
            else {
                console.log(chalk_1.default.green("-> Git push go back snapshot version"));
            }
        });
    });
}
function gitAddChanges() {
    return __awaiter(this, void 0, void 0, function* () {
        yield git.add(["**/pom.xml", "./pom.xml"], (err) => {
            if (err) {
                console.error(chalk_1.default.red(`-> Error during git add change:`, err));
                process.exit(1);
            }
            else {
                console.log(chalk_1.default.green(`-> Files added to the staging area path`));
            }
        });
    });
}
if (!process.argv.slice(2).length) {
    console.log(chalk_1.default.red(figlet_1.default.textSync("Xstarva CLI", {
        horizontalLayout: "default",
        verticalLayout: "default",
        width: 100,
        whitespaceBreak: true,
    })));
}
program.parse(process.argv);
//# sourceMappingURL=index.js.map