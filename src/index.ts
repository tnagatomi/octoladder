import * as core from "@actions/core";
import { OctoladderConfig } from "./config.js";
import { GithubClient } from "./github-client.js";
import { Site } from "./site.js";
import { State } from "./state.js";
import { Sync } from "./sync.js";
import { TeamsConfig } from "./teams-config.js";

async function main(): Promise<void> {
  const token = core.getInput("token", { required: true });
  const configPath = core.getInput("config-path") || "config/octoladder.yml";
  const teamsPath = core.getInput("teams-path") || "config/teams.yml";
  const statePath = core.getInput("state-path") || "data/state.json";
  const outputDir = core.getInput("output-dir") || "site";

  const config = OctoladderConfig.load(configPath);
  const teamsConfig = TeamsConfig.load(teamsPath);
  const state = State.load(statePath);
  const logger = { warn: (msg: string) => core.warning(msg) };
  const client = new GithubClient(token, logger);

  core.info("Reconciling team membership and fetching merged PRs...");
  await new Sync({
    state,
    teamsConfig,
    githubClient: client,
    config,
    logger,
  }).call();
  state.save(statePath);

  core.info(`Rendering site to ${outputDir}/`);
  new Site({ state, outputDir, timeZone: config.timeZone }).call();

  core.info("Done.");
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
