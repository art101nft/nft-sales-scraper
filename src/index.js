const ALL_CONTRACTS = require('./contracts');

import Moralis from 'moralis';
const { Database } = require('sqlite3');
const fs = require('fs');


const assetsBase = 'https://art101-assets.s3.us-west-2.amazonaws.com';
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

  async postDiscord() {
    if (! process.env.DISCORD_URL) return
    db.all('SELECT * FROM events WHERE discord_sent = 0 AND contract = ?',[this.contractAddress], async (err, r) => {
      r.map(async row => {
        try {
          const title = `Sale of token ${row.token_id} for ${this.contractName}!`;
          const desc = `Purchased by ${row.buyer} in block ${row.block_number} for ${Number(row.sale_price) / 1000000000000000000.0}Ξ. [Etherscan](https://etherscan.io/tx/${row.tx_hash})`;
          const url = `${assetsBase}/${this.contractAddress}/${row.token_id.toString()}.json`;
          const metadata = await fetch(url)
            .then((m) => m.json());
          const imageURL = metadata.image.replace('ipfs://', `${assetsBase}/${this.contractAddress}/`) + '.fullsize.png';
          await sleep(2);
          await fetch(process.env.DISCORD_URL, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              embeds: [
                {
                  title: title,
                  description: desc,
                  image: {
                    url: imageURL
                  },
                  url: `https://gallery.art101.io/collection/${this.contractName}/${row.token_id}`
                }
              ]
            })
          });
          db.run(`UPDATE events SET discord_sent = 1 WHERE contract = ? AND token_id = ? and block_number = ?`, [
            row.contract, row.token_id, row.block_number
          ]);
          return `posted sale info to Discord: ${title} - ${desc} - ${imageURL}`;
        } catch(err) {
          throw new Error(`[!] Failed to post to Discord: ${err}`);
        }
      });
    });

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

function shortenAddress(address) {
  const shortAddress = `${address.slice(0, 6)}...${address.slice(address.length - 4, address.length)}`;
  if (address.startsWith('0x')) return shortAddress;
  return address;
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
        await c.postDiscord();
      } catch(e) {
        console.log(e);
      }
      await sleep(1);
    }
  }
})();