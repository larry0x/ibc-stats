import * as fs from "fs";

export type RelayerProfile = {
  numOutboundPackets: number;
  numInboundPackets: number;
  feesPaid: { [key: string]: number };
};

export class RelayerProfiles {
  profiles: { [key: string]: RelayerProfile };

  constructor() {
    this.profiles = {};
  }

  incrementInboundPacketCount(relayer: string) {
    if (relayer in this.profiles) {
      this.profiles[relayer].numInboundPackets += 1;
    } else {
      this.profiles[relayer] = {
        numOutboundPackets: 0,
        numInboundPackets: 1,
        feesPaid: {},
      };
    }
  }

  incrementOutboundPacketCount(relayer: string) {
    if (relayer in this.profiles) {
      this.profiles[relayer].numOutboundPackets += 1;
    } else {
      this.profiles[relayer] = {
        numOutboundPackets: 1,
        numInboundPackets: 0,
        feesPaid: {},
      };
    }
  }

  incrementFeesPaid(relayer: string, denom: string, amount: number) {
    if (relayer in this.profiles) {
      if (denom in this.profiles[relayer].feesPaid) {
        this.profiles[relayer].feesPaid[denom] += amount;
      } else {
        this.profiles[relayer].feesPaid = { [denom]: amount };
      }
    } else {
      this.profiles[relayer] = {
        numOutboundPackets: 0,
        numInboundPackets: 0,
        feesPaid: { [denom]: amount },
      };
    }
  }

  writeToFile(path: string) {
    fs.writeFileSync(path, JSON.stringify(this.profiles, null, 2));
  }
}
