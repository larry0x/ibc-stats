# IBC Relayer Study

Pulls transactions and compile data regarding IBC relayer activities.

Start `mongod` in background:

```bash
mkdir db
mongod --fork --dbpath db --logpath mongod.log
```

Fetch all IBC-related transactions and dump them in the database. Here `4985676` is the block where Terra's first ever IBC transaction was posted.

```bash
ts-node src/main.ts --start-height 4985676 --end-height 5000000 --grpc-gateway-url http://localhost:1317 \
```

To run the script in background without interuption:

```bash
nohup ts-node src/main.ts [flags] > fetch_txs.log &
```