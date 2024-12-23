const ALL_CONTRACTS = require('./contracts');

const { Alchemy, Network } = require("alchemy-sdk");
const { Database } = require('sqlite3');
const { ethers } = require("ethers");
const fs = require('fs');


const db = new Database('./state/sqlite.db');
const config = {
    apiKey: process.env.ALCHEMY_KEY,
    network: Network.ETH_MAINNET,
};

const alchemy = new Alchemy(config);


async function sleep(sec) {
  return new Promise((resolve) => setTimeout(resolve, Number(sec) * 1000));
}


class Scrape {

  constructor (contractName) {
    if (!(contractName in ALL_CONTRACTS)) {
      console.warn(`[!] That contract name does not exist in data/contracts.json`);
      process.exit();
    }
    const data = ALL_CONTRACTS[contractName];
    this.contractName = contractName;
    this.contractAddress = data['contract_address'];
    this.erc1155 = data['erc1155'];
    this.startBlock = data['start_block'];
    this.lastFile = `./state/${this.contractName}.txt`;
  }

  getpageKey() {
    if (fs.existsSync(this.lastFile)) {
      return fs.readFileSync(this.lastFile).toString();
    } else {
      fs.writeFileSync(this.lastFile, '');
      return null
    };
  }

  async scrape() {
    const pageKey = this.getpageKey() || null
    console.log(`[+] Scraping ${this.contractName} with pageKey ${pageKey}`)
    const response = await alchemy.nft.getNftSales({
        fromBlock: this.startBlock,
        contractAddress: this.contractAddress,
        limit: process.env.LIMIT,
        order: 'asc',
        pageKey: pageKey
    });
    fs.writeFileSync(this.lastFile, response.pageKey)
    response.nftSales.map(async (sale) => {
      const rowExists = await new Promise((resolve) => {
        db.get('SELECT * FROM events WHERE tx_hash = ? AND log_index = ?', [sale.transactionHash, sale.logIndex], (err, row) => {
          if (err) { resolve(false); }
          resolve(row !== undefined);
        });
      });
      if (!rowExists) {
        try {
          db.run(`
            INSERT INTO events VALUES (
            "${sale.contractAddress}",
            "${sale.buyerAddress}",
            "${sale.sellerAddress}",
            "${sale.taker}",
            "${sale.tokenId}",
            "${sale.sellerFee.amount}",
            "${sale.protocolFee.amount}",
            "${sale.royaltyFee.amount}",
            "",
            "${sale.transactionHash}",
            "${sale.blockNumber}",
            "${sale.logIndex}",
            "${sale.bundleIndex}",
            "${sale.marketplace}",
            0, 0
          )`);
          console.log(` ::: Inserted sale of ${this.contractName} #${sale.tokenId} in block ${sale.blockNumber} for ${sale.sellerFee.amount} wei.`)
        } catch(err) {
          console.log(`Error when writing to database: ${err}`);
          return false;
        }
      }
    });

    await sleep(1);

  }

}

(async () => {
  const tableExists = await new Promise((resolve) => {
    db.get('SELECT name FROM sqlite_master WHERE type="table" AND name="events"', [], (err, row) => {
      if (err) {
        resolve(false);
      }
      resolve(row !== undefined);
    });
  });
  if (!tableExists) {
    db.serialize(() => {
      db.run(
        `CREATE TABLE events (
          contract text,
          buyer text,
          seller text,
          taker text,
          token_id number,
          sale_price text,
          protocol_fee text,
          royalty_fee text,
          tx_date text,
          tx_hash text,
          block_number number,
          log_index number,
          bundle_index number,
          marketplace text,
          discord_sent number,
          twitter_sent number,
          UNIQUE(tx_hash, log_index, bundle_index)
        );`,
      );
    });
  }
  while(true) {
    for(const contract in ALL_CONTRACTS) {
      if (process.env.ONLY && process.env.ONLY != contract) continue
      const c = new Scrape(contract);
      try {
        await c.scrape();
      } catch(e) {
        console.log(e);
      }
      await sleep(3);
    }
  }
})();