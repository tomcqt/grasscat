import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
// import Log from "../util/log.js"; // replaced this with console.log

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

// message from tomcat:
// robbed from NullDev's code, you can find it here:
// https://github.com/NullDev/Arithmetica-Bot/blob/master/src/util/mathEval.js
// :3 thx NullDev
// (anything else with Copyright (c) NullDev is also from NullDev's code, I just copied it over to my repo)
// :end message from tomcat

const computationLimitSecs = 5;

/**
 * Evaluate a math expression using a worker process for timeout protection
 *
 * @param {String} expr
 * @return {Promise<{ result: Number|null, error: String|null }>}
 */
async function mathEval(expr) {
  return new Promise((resolve) => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const workerPath = join(__dirname, "mathWorker.js");

    // Spawn worker process
    const worker = spawn("node", [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      worker.kill("SIGKILL");
      resolve({
        result: null,
        error:
          "Function execution exceeded " + computationLimitSecs + " seconds",
      });
    }, computationLimitSecs * 1000);

    let output = "";
    let errorOutput = "";

    worker.stdout.on("data", (data) => {
      output += data.toString();
    });

    worker.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    worker.on("close", (code) => {
      clearTimeout(timeoutId);

      if (code !== 0) {
        resolve({
          result: null,
          error: errorOutput || "Worker process failed",
        });
        return;
      }

      try {
        const result = JSON.parse(output);
        resolve(result);
      } catch (e) {
        console.log("Error in MathEval: ", e);
        resolve({
          result: null,
          error: "Failed to parse worker output",
        });
      }
    });

    // Send expression to worker
    worker.stdin.write(JSON.stringify({ expression: expr }) + "\n");
    worker.stdin.end();
  });
}

export default mathEval;
