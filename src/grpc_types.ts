export type Coin = {
  denom: string;
  amount: string;
};

export interface Msg {
  "@type": string;
}

export interface IBCMsg extends Msg {
  signer: string;
}

export interface Tx {
  body: {
    messages: Msg[];
  };
  auth_info: {
    fee: {
      amount: Coin[];
    };
  };
}

export type Attribute = {
  key: string;
  value: string;
};

export interface Event {
  type: string;
  attribute: Attribute[];
}

export interface Log {
  msg_index: number;
  events: Event[];
}

export interface TxResponse {
  height: string;
  txhash: string;
  tx: Tx;
  logs: Log[];
}

export interface TxsResponse {
  tx_responses: TxResponse[];
  pagination: { total: string };
}
