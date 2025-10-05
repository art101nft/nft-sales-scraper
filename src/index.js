const ALL_CONTRACTS = require('./contracts');

import Moralis from 'moralis';
const { Database } = require('sqlite3');
const fs = require('fs');

const db = new Database('./state/sqlite.db');
const config = {
  apiKey: process.env.MORALIS_KEY
};


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

  getCursor() {
    if (fs.existsSync(this.lastFile)) {
      return fs.readFileSync(this.lastFile).toString();
    } else {
      fs.writeFileSync(this.lastFile, '');
      return null
    };
  }

  async scrape() {
    const cursor = this.getCursor()
    if (cursor === '') {
      console.log(`no cursor for ${this.contractName}. skipping`)
      return
    }

    console.log(`[+] Scraping ${this.contractName}`);
    const response = await Moralis.EvmApi.nft.getNFTTrades({
      chain: '0x1',
      marketplace: 'opensea',
      fromBlock: this.startBlock,
      address: this.contractAddress,
      limit: process.env.LIMIT,
      cursor: cursor
    });

    fs.writeFileSync(this.lastFile, response.json.cursor || '')

    response.json.result.map(async (sale) => {
      sale.token_ids.map(async (tokenId) => {
        const rowExists = await new Promise((resolve) => {
          db.get('SELECT * FROM events WHERE tx_hash = ? AND token_id = ?', [sale.transaction_hash, tokenId], (err, row) => {
            if (err) { resolve(false); }
            resolve(row !== undefined);
          });
        });
        if (!rowExists) {
          try {
            db.run(`
              INSERT INTO events VALUES (
              "${this.contractAddress}",
              "${sale.buyer_address}",
              "${sale.seller_address}",
              "${tokenId}",
              "${sale.price}",
              "",
              "${sale.transaction_hash}",
              "${sale.block_number}",
              "opensea",
              "${cursor}",
              0, 0
            )`);
            console.log(` ::: Inserted sale of ${this.contractName} #${tokenId} in block ${sale.block_number} for ${sale.price} wei.`)
          } catch(err) {
            console.log(`Error when writing to database: ${err}`);
            return false;
          }
        }
      });

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
          token_id number,
          sale_price text,
          tx_date text,
          tx_hash text,
          block_number number,
          marketplace text,
          cursor text,
          discord_sent number,
          twitter_sent number,
          UNIQUE(tx_hash, token_id)
        );`,
      );
    });
  }
  await Moralis.start(config);
  while(true) {
    for(const contract in ALL_CONTRACTS) {
      if (process.env.ONLY && process.env.ONLY != contract) continue
      const c = new Scrape(contract);
      try {
        await c.scrape();
      } catch(e) {
        console.log(e);
      }
      await sleep(1);
    }
  }
})();