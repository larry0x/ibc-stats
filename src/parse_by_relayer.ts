import * as fs from "fs";
import { MongoClient } from "mongodb";
import * as types from "./grpc_types";

const DEFAULT_MONGODB_URL = "mongodb://localhost:27017";

const IBC_MESSAGE_TYPES = [
  "/ibc.core.channel.v1.MsgRecvPacket",
  "/ibc.core.channel.v1.MsgAcknowledgement",
];

class RelayerProfile {
  numOutboundPackets = 0;
  numInboundPackets = 0;
  numRedundantPackets = 0;
  totalGasUsed = 0;
  totalGasWanted = 0;
  feesPaid: { [key: string]: number } = {};
}

class RelayerProfiles {
  profiles: { [key: string]: RelayerProfile } = {};

  incrementInboundPacketCount(relayer: string) {
    if (!(relayer in this.profiles)) {
      this.profiles[relayer] = new RelayerProfile();
    }
    this.profiles[relayer].numInboundPackets += 1;
  }

  incrementOutboundPacketCount(relayer: string) {
    if (!(relayer in this.profiles)) {
      this.profiles[relayer] = new RelayerProfile();
    }
    this.profiles[relayer].numOutboundPackets += 1;
  }

  incrementRedundantPacketCount(relayer: string) {
    if (!(relayer in this.profiles)) {
      this.profiles[relayer] = new RelayerProfile();
    }
    this.profiles[relayer].numRedundantPackets += 1;
  }

  incrementGas(relayer: string, gasUsed: number, gasWanted: number) {
    if (!(relayer in this.profiles)) {
      this.profiles[relayer] = new RelayerProfile();
    }
    this.profiles[relayer].totalGasUsed += gasUsed;
    this.profiles[relayer].totalGasWanted += gasWanted;
  }

  incrementFeesPaid(relayer: string, denom: string, amount: number) {
    if (!(relayer in this.profiles)) {
      this.profiles[relayer] = new RelayerProfile();
    }
    if (denom in this.profiles[relayer].feesPaid) {
      this.profiles[relayer].feesPaid[denom] += amount;
    } else {
      this.profiles[relayer].feesPaid = { [denom]: amount };
    }
  }

  writeJSON(path: string) {
    fs.writeFileSync(path, JSON.stringify(this.profiles, null, 2));
  }

  writeCSV(path: string) {
    const header =
      "address,num_outbound_packets,num_inbound_packets,num_redundant_packets,total_gas_used,total_gas_wanted,fees_paid\n";
    const body = Object.entries(this.profiles)
      .sort(([, aProfile], [, bProfile]) => {
        const aNumNonRedundantTxs = aProfile.numInboundPackets + aProfile.numOutboundPackets;
        const bNumNonRedundantTxs = bProfile.numInboundPackets + bProfile.numOutboundPackets;
        if (aNumNonRedundantTxs < bNumNonRedundantTxs) return 1;
        if (aNumNonRedundantTxs > bNumNonRedundantTxs) return -1;
        return 0;
      })
      .map(([address, profile]) => {
        return [
          address,
          profile.numOutboundPackets.toString(),
          profile.numInboundPackets.toString(),
          profile.numRedundantPackets.toString(),
          profile.totalGasUsed.toString(),
          profile.totalGasWanted.toString(),
          Object.entries(profile.feesPaid)
            .map(([denom, amount]) => `${denom}:${amount}`)
            .join("|"),
        ].join(",");
      })
      .join("\n");
    fs.writeFileSync(path, header + body);
  }
}

function isIbcPacket(msg: types.Msg): boolean {
  if (IBC_MESSAGE_TYPES.includes(msg["@type"])) {
    return true;
  }
  return false;
}

/**
 * @dev NOTE: In addition to redundant txs, also returns false if the tx failed
 */
function isNonRedundant(msg: types.Msg, log?: types.Log): boolean {
  // For failed txs, log is undefined
  if (!log) return false;
  // For an inbound packet, we make sure it is non-redundant by checking whether it emits a
  // `write_acknowledgement` event
  if (msg["@type"] === "/ibc.core.channel.v1.MsgRecvPacket") {
    const event = log.events.find((event) => event.type === "write_acknowledgement");
    if (event) {
      return true;
    }
  }
  // For an outbound package, we make sure it is non-redundant by checking whether is emits more
  // than 2 events
  //
  // Every `MsgAcknowledgement` emits at least two events, `acknowledge_packet` and `message`.
  // Non-redundant ones additionally emits one or more events indicating the action being acknowledged,
  // such as `fungible_token_packet` for ICS20 packets
  //
  // Same with the timeout message
  else if (
    ["/ibc.core.channel.v1.MsgAcknowledgement", "/ibc.core.channel.v1.MsgTimeout"].includes(
      msg["@type"]
    )
  ) {
    if (log.events.length > 2) {
      return true;
    }
  }
  return false;
}

export function parseTxResponse(txResponse: types.TxResponse, relayerProfiles: RelayerProfiles) {
  const signers: string[] = [];
  txResponse.tx.body.messages.forEach((msg, msgIndex) => {
    if (isIbcPacket(msg)) {
      const signer = (msg as types.IBCMsg).signer;
      if (!signers.includes(signer)) {
        signers.push(signer);
      }

      const log = txResponse.logs.find((log) => log.msg_index === msgIndex);
      if (isNonRedundant(msg, log)) {
        if (msg["@type"] === "/ibc.core.channel.v1.MsgRecvPacket") {
          relayerProfiles.incrementInboundPacketCount(signer);
        } else if (msg["@type"] === "/ibc.core.channel.v1.MsgAcknowledgement") {
          relayerProfiles.incrementOutboundPacketCount(signer);
        }
      } else {
        relayerProfiles.incrementRedundantPacketCount(signer);
      }
    }
  });

  // If the tx contains at least one non-redundant IBC message, we add up gas fee paid for this tx
  // to the relayer's profile
  if (signers.length > 0) {
    // Currently we don't consider the situation where there are more than one relayer in one tx, or
    // when the fees are paid in more than one coins. In such cases, we simply throw errors
    if (signers.length > 1) {
      throw new Error(`tx contains msgs from multiple relayers: ${txResponse.txhash} `);
    }
    const signer = signers[0];

    if (txResponse.tx.auth_info.fee.amount.length > 1) {
      throw new Error(`tx fee paid in more than one denoms: ${txResponse.txhash}`);
    }
    const fee = txResponse.tx.auth_info.fee.amount[0];

    relayerProfiles.incrementFeesPaid(signer, fee.denom, parseInt(fee.amount));
  }
}

export async function ParseIbcMsgsByRelayer() {
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
  const col = db.collection<types.TxResponse>("txs");
  console.log("done!");

  const relayerProfiles = new RelayerProfiles();
  try {
    const c = col.find();
    const total = await c.count();
    for (let count = 1; count <= total; count++) {
      const txResponse = await c.next();
      const percentage = Math.floor((100 * count) / total);
      if (count % 100 == 0 || count == total) {
        console.log(`${count}/${total} (${percentage}%) txhash: ${txResponse?.txhash}`);
      }
      if (txResponse) {
        parseTxResponse(txResponse, relayerProfiles);
      }
    }
  } catch (err) {
    console.log("unrecoverable error!", err);
  } finally {
    process.stdout.write("closing client... ");
    await client.close();
    console.log("done!");
  }
  return relayerProfiles;
}
