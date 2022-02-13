import axios from "axios";
import * as grpc from "./grpc_types";
import { RelayerProfiles } from "./profile";

export async function fetchTxResponsesInBlock(
  height: number,
  grpcGatewayUrl: string
): Promise<grpc.TxResponse[]> {
  let txResponses: grpc.TxResponse[] = [];
  while (true) {
    const grpcTxsResponse = (
      await axios.get<grpc.GRPCTxsResponse>(
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

export function parseTxResponse(txResponse: grpc.TxResponse, relayerProfiles: RelayerProfiles) {
  const signers: string[] = [];
  let msgIndex = 0;
  for (const msg of txResponse.tx.body.messages) {
    // For an inbound packet, we make sure it is non-redundant by checking whether it emits a
    // `write_acknowledgement` event
    if (msg["@type"] === "/ibc.core.channel.v1.MsgRecvPacket") {
      const log = txResponse.logs.find((log) => log.msg_index === msgIndex);
      if (log) {
        const event = log.events.find((event) => event.type === "write_acknowledgement");
        if (event) {
          const signer = (msg as grpc.IBCMsg).signer;
          if (!signers.includes(signer)) {
            signers.push(signer);
          }
          relayerProfiles.incrementInboundPacketCount(signer);
        }
      }
    }
    // For an outbound package, we make sure it is non-redundant by checking whether is emits more
    // than 2 events. Every `MsgAcknowledgement` emits at least two events, `acknowledge_packet` and
    // `message`. Non-redundant ones additionally emits one or more events indicating the action
    // being acknowledged, such as `fungible_token_packet` for ICS20 packets
    else if (msg["@type"] === "/ibc.core.channel.v1.MsgAcknowledgement") {
      const log = txResponse.logs.find((log) => log.msg_index === msgIndex);
      if (log) {
        if (log.events.length > 2) {
          const signer = (msg as grpc.IBCMsg).signer;
          if (!signers.includes(signer)) {
            signers.push(signer);
          }
          relayerProfiles.incrementOutboundPacketCount(signer);
        }
      }
    }
    msgIndex += 1;
  }

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

export function parseTxResponses(txResponses: grpc.TxResponse[], relayerProfiles: RelayerProfiles) {
  for (const txResponse of txResponses) {
    parseTxResponse(txResponse, relayerProfiles);
  }
}
