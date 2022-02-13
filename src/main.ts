import * as path from "path";
import yargs from "yargs/yargs";
import { fetchTxResponsesInBlock, parseTxResponses } from "./parse";
import { RelayerProfiles } from "./profile";

const argv = yargs(process.argv)
  .options({
    "start-block": {
      type: "number",
      demandOption: true,
    },
    "end-block": {
      type: "number",
      demandOption: true,
    },
    "grpc-gateway-url": {
      type: "string",
      demandOption: true,
    },
  })
  .parseSync();

(async function () {
  const relayerProfiles = new RelayerProfiles();
  const total = argv["end-block"] - argv["start-block"] + 1;
  for (let i = 0; i < total; i++) {
    const height = argv["start-block"] + i;
    console.log(`${i + 1}/${total} [${((100 * (i + 1)) / total).toFixed(2)}%]`);
    parseTxResponses(
      await fetchTxResponsesInBlock(height, argv["grpc-gateway-url"]),
      relayerProfiles
    );
  }

  const filePath = path.join(__dirname, "../data/result.json");
  relayerProfiles.writeToFile(filePath);
  console.log(`done! result wrote to ${filePath}`);
})();
