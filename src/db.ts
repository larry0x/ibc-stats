import axios from "axios";
import chalk from "chalk";
import { MongoClient } from "mongodb";
import * as types from "./grpc_types";

const DEFAULT_MONGODB_URL = "mongodb://localhost:27017";
const DEFAULT_LAST_HEIGHT = 4724000; // the last block of col-4
const DEFAULT_GRPC_GATEWAY_URL = "https://lcd.terra.dev";

/**
 * @notice Fetch all transactions in a block
 */
async function fetchTxsInBlock(
  height: number,
  grpcGatewayUrl: string
): Promise<types.TxResponse[]> {
  let txResponses: types.TxResponse[] = [];
  while (true) {
    const grpcTxsResponse = (
      await axios.get<types.TxsResponse>(
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

/**
 * @notice Return `true` if the transaction contains at least one IBC-related message
 */
function containsIbcMsg(txResponse: types.TxResponse): boolean {
  return txResponse.tx.body.messages.map((msg) => msg["@type"].includes("ibc")).includes(true);
}

/**
 * @notice Fetch all transactions containing IBC-related messages between two block heights
 */
export async function fetchIbcPacketTxs(
  endHeight: number,
  startHeight?: number,
  grpcGatewayUrl?: string
) {
  process.stdout.write("creating mongodb client... ");
  const client = new MongoClient(DEFAULT_MONGODB_URL);
  console.log(chalk.green("done!"));

  process.stdout.write("connecting client...");
  await client.connect();
  console.log(chalk.green("done!"));

  process.stdout.write("creating db...");
  const db = client.db("TerraIBCRelayerStats");
  console.log(chalk.green("done!"));

  process.stdout.write("creating collections...");
  const col = db.collection<types.TxResponse>("txs");
  console.log(chalk.green("done!"));

  // If start height is given, we start from it
  // If not, fetch the last tx in the database, and start from that block height + 1
  // If no tx exists, start from default
  const lastHeight = startHeight
    ? startHeight - 1
    : await (async function () {
        const lastTx = await col.find().sort({ _id: -1 }).limit(1).next();
        return lastTx ? parseInt(lastTx.height) : DEFAULT_LAST_HEIGHT;
      })();

  const total = endHeight - lastHeight;
  const url = grpcGatewayUrl ? grpcGatewayUrl : DEFAULT_GRPC_GATEWAY_URL;

  try {
    for (let i = 1; i <= total; i++) {
      const height = lastHeight + i;
      const percent = Math.floor((100 * i) / total);
      process.stdout.write(
        `${chalk.yellow(i)}/${chalk.yellow(total)} (${percent}%) ${chalk.blue("height")}=${height} `
      );

      // Download all txs at the height
      const allTxs = await fetchTxsInBlock(height, url);

      // Retain only txs that contain `MsgRecvPacket` and `MsgAcknowledgement` messages
      const txs = allTxs.filter((tx) => containsIbcMsg(tx));

      // Add txs to database
      if (txs.length > 0) {
        await col.insertMany(txs);
      }

      console.log(
        chalk.green("done!"),
        `${chalk.blue("txs_in_block")}=${txs.length}`,
        `${chalk.blue("total_txs")}=${await col.countDocuments()}`
      );
    }
  } catch (err) {
    console.log(chalk.red("unrecoverable error!"), err);
  } finally {
    process.stdout.write("closing client... ");
    await client.close();
    console.log(chalk.green("done!"));
  }
}
