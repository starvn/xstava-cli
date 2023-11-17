#! /usr/bin/env node

import { Command } from "commander";
import figlet from "figlet";
import chalk from "chalk";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
import readline from "readline";
import { parseString } from "xml2js";
import os from "os";

const platform = os.platform();
const program = new Command();
const git = simpleGit({ baseDir: path.dirname("./") });
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let mvn = "./mvnw"
if (platform === 'win32') {
  mvn = "./mvnw.cmd"
}

program.name(chalk.green("Xstarva Devtools CLI"));

program
.command("build")
.description("build project locally")
.option("--skip-tests", "skips compiling the tests")
.option("-p, --profiles <profiles>", "active profiles")
.option("--debug", "build with debug")
.action((options) => {
  try {
    if (options.skipTests) {
      console.log(chalk.blue("-> Building project with skip tests..."));
    } else {
      console.log(chalk.blue("-> Building project..."));
    }
    const command = mvn + ` clean install -s .settings.xml ${
        options.skipTests ? "-DskipTests" : ""
    } ${options.profiles ? "-P " + options.profiles : ""}  ${
        options.debug ? "--debug" : ""
    }`;
    const childProcess = exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(chalk.red(`-> Error during build locally: ${stderr}`));
      }
    });
    childProcess.stdout?.on("data", (log) => {
      console.log(chalk.green(log));
    });
  } catch (error: any) {
    console.error(chalk.red("-> Error during build locally", error.message));
    process.exit(1);
  }
});

program
.command("publish <type>")
.description("publish to gitlab package registry")
.option("-t, --tag", "tag version gitlab")
.option("--bump", "bump version")
.action(async (type, options) => {
  try {
    const typeAllowPublish = ["SNAPSHOT", "RC", "RELEASE"];
    if (!typeAllowPublish.includes(type.trim().toUpperCase())) {
      console.error(
          chalk.red(
              `-> Unsupported publish type '${type}', please choose 'SNAPSHOT', 'RC' or 'RELEASE'`
          )
      );
      process.exit(1);
    }

    const tag = options.tag;
    const bumpVersion = options.bump;
    const parentPomPath = "./pom.xml";

    const version = (await parseParentPom(
        fs.readFileSync(parentPomPath, "utf-8"),
        parentPomPath,
        type
    )) as string;
    const versionItem = version.split(".");
    let nextVersion =
        versionItem[0] +
        "." +
        versionItem[1] +
        "." +
        (parseInt(versionItem[2]) + 1);
    const branch = (await getCurrentGitBranch()) as string;

    console.log(
        chalk.blue(
            `-> Processing publish to gitlab registry with version: ${version}-${type}`
        )
    );
    console.log(chalk.blue(`-> Git fetch`));
    await git.fetch((err, update) => {
      if (err) {
        console.error(chalk.red("-> Error during git fetch:"), err);
        process.exit(1);
      } else {
        console.log(chalk.green("-> Git fetch successful"));
      }
    });

    console.log(chalk.blue(`-> Git pull rebase \`origin\` main branch`));
    await git.pull("origin", branch, ["--rebase"], (err, update) => {
      if (err) {
        console.error(
            chalk.red("-> Error during git pull rebase origin main:"),
            err
        );
        process.exit(1);
      } else {
        console.log(chalk.green("-> Git pull rebase origin main successful"));
      }
    });

    console.log(chalk.blue(`-> Git checkout \`${branch}\` branch`));
    await git.checkout(branch, (err) => {
      if (err) {
        console.error(
            chalk.red(`-> Error during git checkout \`${branch}\` branch:`),
            err
        );
        process.exit(1);
      } else {
        console.log(chalk.green(`-> Checked out \`${branch}\``));
      }
    });

    console.log(chalk.blue(`-> Git rebase main branch`));
    await git.rebase([branch], (err) => {
      if (err) {
        console.error(
            chalk.red("-> Error during git rebase main branch:"),
            err
        );
        process.exit(1);
      } else {
        console.log(chalk.green(`-> Rebase onto ${branch} completed`));
      }
    });
    console.log(chalk.green(`-> Newest code updated`));

    if (branch == "main") {
      if (type.endsWith("RELEASE") || type.endsWith("RC")) {
        await updateVersion(
            version,
            type,
            fs.readFileSync(parentPomPath, "utf-8"),
            parentPomPath
        );
        await buildLocallyAndPublish();
        await pushCodeUpdatedVersion(version + "-" + type, branch);
        if (tag) {
          await tagReleaseVersion(version + "-" + type);
        } else {
          console.warn(chalk.yellow(`-> Skipping to tag version`));
        }
        if (!bumpVersion || type.endsWith("RC")) {
          process.exit(1);
        }
        await updateVersion(
            nextVersion,
            "SNAPSHOT",
            fs.readFileSync(parentPomPath, "utf-8"),
            parentPomPath
        );
        await pushCodeUpdatedVersion(nextVersion + "-SNAPSHOT", branch);
        process.exit(1);
      } else {
        console.error(
            chalk.red(
                `-> Invalid publish version type \`${type}\` for current branch is \`${branch}\`, please choose \`RC\` or \`RELEASE\``
            )
        );
        process.exit(1);
      }
    } else if (/^\d+\.\d+\.x+$/.test(branch)) {
      if (type.endsWith("SNAPSHOT")) {
        await updateVersion(
            version,
            type,
            fs.readFileSync(parentPomPath, "utf-8"),
            parentPomPath
        );
        await buildLocallyAndPublish();
        await pushCodeUpdatedVersion(version + "-" + type, branch);
        process.exit(1);
      } else {
        console.error(
            chalk.red(
                `-> Invalid publish version type \`${type}\` for current branch is \`${branch}\`, please choose \`SNAPSHOT\``
            )
        );
        process.exit(1);
      }
    } else {
      console.log(
          chalk.red(
              `-> Publishing on \`non-build\` or \`main\` branches is not supported. Please checkout to build branch (ex: 1.0.x) or main branch to publish`
          )
      );
      process.exit(1);
    }
  } catch (error: any) {
    console.error(chalk.red("Error during publish:", error.message));
    process.exit(1);
  }
});

function askForPublish(defaultNumberVersion: string, publishType: string) {
  return new Promise((resolve) => {
    rl.question(
        `-> Enter publish version ` +
        chalk.grey(`(default version ${defaultNumberVersion})`) +
        `: `,
        (answer) => {
          const versionPattern = /^\d+\.\d+\.\d+$/;
          if (
              answer &&
              !(answer == "") &&
              !versionPattern.test(answer.trim().toUpperCase())
          ) {
            console.warn(
                chalk.yellow(`-> Invalid version. Please re-enter a valid version`)
            );
            resolve(askForPublish(defaultNumberVersion, publishType));
          } else {
            resolve(
                (answer ? answer.trim().toUpperCase() : answer) ||
                `${defaultNumberVersion}`
            );
          }
        }
    );
  });
}

function parseParentPom(
    parentPomContent: string,
    parentPomPath: string,
    type: string
) {
  return new Promise((resolve, reject) => {
    parseString(parentPomContent, async (parseErr, parentResult) => {
      if (parseErr) {
        console.error(
            chalk.red(`-> Error parsing POM file \`${parentPomPath}\``)
        );
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
        const result = await askForPublish(numberVersion, type);
        resolve(result);
      } catch (askForPublishErr) {
        reject(askForPublishErr);
        process.exit(1);
      }
    });
  });
}

function getCurrentGitBranch() {
  return new Promise((resolve, reject) => {
    git.branch([], (err, summary) => {
      if (err) {
        console.error(chalk.red(`-> Error getting current branch`));
        reject(err);
        process.exit(1);
      }
      const currentBranch = summary.current;
      resolve(currentBranch);
    });
  });
}

async function updateVersion(
    version: string,
    type: string,
    parentPomContent: string,
    parentPomPath: string
) {
  console.log(
      chalk.blue(`-> Updating POM project version: ${version}-${type}`)
  );
  parseString(parentPomContent, (parseErr, parentResult) => {
    if (parseErr) {
      console.error(chalk.red(`-> Error parsing ${parentPomPath}:`), parseErr);
      process.exit(1);
    }
    const parentVersion = parentResult.project.version[0];
    if (parentVersion != `${version}-${type}`) {
      findAndReplaceVersionInPom(
          parentPomPath,
          parentVersion,
          `${version}-${type}`
      );
      const modules = parentResult.project.modules
          ? parentResult.project.modules[0].module
          : [];
      for (const moduleName of modules) {
        const childPomPath = path.join(
            path.dirname(parentPomPath),
            moduleName,
            "pom.xml"
        );
        findAndReplaceVersionInPom(
            childPomPath,
            parentVersion,
            `${version}-${type}`
        );
      }
      console.log(chalk.green(`-> Updated project version successful`));
    } else {
      console.log(chalk.green(`-> Updated project version successful`));
    }
  });
}

function findAndReplaceVersionInPom(
    filePath: string,
    targetText: string,
    replacementText: string
) {
  const pomContent = fs.readFileSync(filePath, "utf-8");
  parseString(pomContent, (parseErr, result) => {
    if (parseErr) {
      console.error(chalk.red(`-> Error parsing ${filePath}:`), parseErr);
      return;
    }
    if (JSON.stringify(result).includes(targetText)) {
      const updatedContent = pomContent.replace(
          new RegExp(targetText, "g"),
          replacementText
      );
      fs.writeFileSync(filePath, updatedContent, "utf-8");
      console.log(
          chalk.green(
              `-> ${filePath}: Updated project & parent version \`${targetText}\` to \`${replacementText}\``
          )
      );
    } else {
      console.log(
          chalk.yellow(
              `-> ${filePath}: Project or parent version \`${targetText}\` not found`
          )
      );
    }
  });
}

async function buildLocallyAndPublish() {
  console.log(chalk.blue("-> Build & publish to package registry..."));
  try {
    const command = mvn + ` clean deploy -s .settings.xml`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(
            chalk.red(`-> Error during publish to package registry`)
        );
        process.exit(1);
      }
    });
    console.log(chalk.green("-> Publish to package registry successful"));
  } catch (error: any) {
    console.error(chalk.red("-> Error during publish to package registry"));
    process.exit(1);
  }
}

async function pushCodeUpdatedVersion(version: string, branch: string) {
  console.log(chalk.blue(`-> Processing to commit version updated...`));
  await gitAddChanges();
  await git.commit(`Update version to ${version}`, (err) => {
    if (err) {
      console.error(
          chalk.red("-> Error during git commit version updated", err)
      );
      process.exit(1);
    } else {
      console.log(chalk.green("-> Git commit version updated"));
    }
  });

  console.log(chalk.blue(`-> Processing to push version updated...`));
  await git.push("origin", branch, [], (err) => {
    if (err) {
      console.error(chalk.red("-> Error during git push version updated"));
      process.exit(1);
    } else {
      console.log(chalk.green("-> Git push version updated successful"));
    }
  });
}

async function tagReleaseVersion(version: string) {
  console.log(chalk.blue(`-> Tagging version ${version}`));
  await git.addAnnotatedTag(
      `v` + version,
      `Release version v${version}`,
      (err, tag) => {
        if (err) {
          console.error(chalk.red("-> Error during git tag"));
          process.exit(1);
        } else {
          console.log(chalk.green(`-> Git tag added: v${version}`));
          git.pushTags("origin", [], (err) => {
            if (err) {
              console.error(chalk.red("-> Error during git push tags"));
              process.exit(1);
            } else {
              console.log(chalk.green("-> Tags pushed to the remote repository"));
            }
          });
        }
      }
  );
}

async function pushCodeGoBackVersion(version: string, branch: string) {
  console.log(
      chalk.blue(`-> Processing to go back snapshot version after release...`)
  );
  await gitAddChanges();
  await git.commit(`Go back ${version}-SNAPSHOT`, (err) => {
    if (err) {
      console.error(
          chalk.red("-> Error during git commit go back snapshot:", err)
      );
      process.exit(1);
    } else {
      console.log(chalk.green("-> Git commit go back snapshot successful"));
    }
  });

  console.log(chalk.blue(`-> Processing push go back snapshot version...`));
  await git.push("origin", branch, [], (err) => {
    if (err) {
      console.error(
          chalk.red("-> Error during git push go back snapshot:"),
          err
      );
      process.exit(1);
    } else {
      console.log(chalk.green("-> Git push go back snapshot version"));
    }
  });
}

async function gitAddChanges() {
  await git.add(["**/pom.xml", "./pom.xml"], (err) => {
    if (err) {
      console.error(chalk.red(`-> Error during git add change:`, err));
      process.exit(1);
    } else {
      console.log(chalk.green(`-> Files added to the staging area path`));
    }
  });
}

if (!process.argv.slice(2).length) {
  console.log(
      chalk.red(
          figlet.textSync("Xstarva CLI", {
            horizontalLayout: "default",
            verticalLayout: "default",
            width: 100,
            whitespaceBreak: true,
          })
      )
  );
}

program.parse(process.argv);
