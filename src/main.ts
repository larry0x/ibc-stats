import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

import * as db from "./db";

(async function () {
  await yargs(hideBin(process.argv))
    .command(
      "fetch-txs",
      "Fetch IBC relaying-related txs from a remote node and dump in a local DB",
      (yargs) => {
        return yargs
          .option("end-height", {
            type: "number",
            demandOption: true,
          })
          .option("start-height", {
            type: "number",
            demandOption: false,
          })
          .option("grpc-gateway-url", {
            type: "string",
            demandOption: false,
          });
      },
      (argv) =>
        db
          .fetchIbcPacketTxs(argv["end-height"], argv["start-height"], argv["grpc-gateway-url"])
          .catch((err) => {
            console.log(err);
            process.exit(1);
          })
    )
    .parse();
})();
