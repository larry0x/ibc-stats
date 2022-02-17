import axios from "axios";
import yargs from "yargs/yargs";
import { MongoClient, Collection } from "mongodb";
import { TxResponse, GRPCTxsResponse } from "./grpc_types";

const DEFAULT_MONGODB_URL = "mongodb://localhost:27017";
const DEFAULT_LAST_HEIGHT = 4724000; // the last block of col-4
const DEFAULT_GRPC_GATEWAY_URL = "https://lcd.terra.dev";

async function fetchTxsInBlock(height: number, grpcGatewayUrl: string): Promise<TxResponse[]> {
  let txResponses: TxResponse[] = [];
  while (true) {
    const grpcTxsResponse = (
      await axios.get<GRPCTxsResponse>(
        `${grpcGatewayUrl}/cosmos/tx/v1beta1/txs?events=tx.height=${height}&pagination.offset=${txResponses.length}`
      )
    ).data;
    txResponses = txResponses.concat(grpcTxsResponse.tx_responses);
    if (txResponses.length >= parseInt(grpcTxsResponse.pagination.total)) {
      break;
    }
  }
  return txResponses;
}

function containsIbcPackets(txResponse: TxResponse): boolean {
  return txResponse.tx.body.messages
    .map((msg) => {
      return [
        "/ibc.core.channel.v1.MsgRecvPacket",
        "/ibc.core.channel.v1.MsgAcknowledgement",
      ].includes(msg["@type"]);
    })
    .includes(true);
}

async function fetchTxs(
  col: Collection<TxResponse>,
  endHeight: number,
  startHeight?: number,
  grpcGatewayUrl?: string
) {
  // If start height is given, we start from it
  // If not, fetch the last tx in the database, and start from that block height + 1
  // If no tx exists, start from default
  const lastHeight = startHeight
    ? startHeight - 1
    : await (async function () {
        const lastTx = await col.find().sort({ _id: -1 }).limit(1).next();
        return lastTx ? parseInt(lastTx.height) : DEFAULT_LAST_HEIGHT;
      })();

  const url = grpcGatewayUrl ? grpcGatewayUrl : DEFAULT_GRPC_GATEWAY_URL;
  const total = endHeight - lastHeight;
  for (let i = 1; i <= total; i++) {
    const height = lastHeight + i;
    const percentage = Math.floor((100 * i) / total);
    process.stdout.write(`[${i}/${total} (${percentage}%)] fetching txs at height ${height}... `);

    // Download all txs at the height
    const allTxs = await fetchTxsInBlock(height, url);

    // Retain only txs that contain `MsgRecvPacket` and `MsgAcknowledgement` messages
    const txs = allTxs.filter((tx) => containsIbcPackets(tx));

    // Add txs to database
    if (txs.length > 0) {
      await col.insertMany(txs);
    }

    console.log(`done! number of txs: ${txs.length}`);
  }
}

(async function () {
  const argv = yargs(process.argv)
    .options({
      "end-height": {
        type: "number",
        demandOption: true,
      },
      "start-height": {
        type: "number",
        demandOption: false,
      },
      "grpc-gateway-url": {
        type: "string",
        demandOption: false,
      },
    })
    .parseSync();

  process.stdout.write("creating mongodb client... ");
  const client = new MongoClient(DEFAULT_MONGODB_URL);
  console.log("done!");

  process.stdout.write("connecting client...");
  await client.connect();
  console.log("done!");

  process.stdout.write("creating db...");
  const db = client.db("TerraIBCRelayerStats");
  console.log("done!");

  process.stdout.write("creating collections...");
  const col = db.collection<TxResponse>("txs");
  console.log("done!");

  try {
    await fetchTxs(col, argv["end-height"], argv["start-height"], argv["grpc-gateway-url"]);
  } catch (err) {
    console.log("unrecoverable error!", err);
  } finally {
    process.stdout.write("closing client... ");
    await client.close();
    console.log("done!");
  }
})();
