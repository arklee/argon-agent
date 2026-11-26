/**
 * Configure SDK defaults before importing pi. The backend owns this process;
 * inherited pi CLI paths must never select its credentials or sessions.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const home = resolve(process.env.ARGON_HOME ?? join(homedir(), ".argon"));
process.env.PI_CONFIG_DIR_NAME = ".argon";
process.env.PI_CODING_AGENT_DIR = join(home, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(home, "agent", "sessions");
