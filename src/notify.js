import ALL_CONTRACTS from './contracts.json' assert { type: 'json' };
import sqlite3 from 'sqlite3';

const Database = sqlite3.Database;
const db = new Database('./state/sqlite.db');

function getContractName(contractAddress) {
    for (const contractName in ALL_CONTRACTS) {
        const contract = ALL_CONTRACTS[contractName];
        if (contract.contract_address && contract.contract_address.toLowerCase() === contractAddress.toLowerCase()) {
            return contractName;
        }
    }
    return null;
}

function processMessages() {
    if (! process.env.DISCORD_URL) return
    db.all('SELECT * FROM events WHERE discord_sent = 0 ORDER BY block_number ASC', async (err, r) => {
    if (err) {
        console.error('Database query error:', err);
        return;
    }
    for (const row of r) {
        try {
            const contractName = getContractName(row.contract);
            const title = `Sale of token ${row.token_id} for ${contractName}!`;
            const desc = `Purchased by ${shortenAddress(row.buyer)} in block ${row.block_number} for ${Number(row.sale_price) / 1000000000000000000.0}Ξ. [Etherscan](https://etherscan.io/tx/${row.tx_hash})`;
            const imageURL = `https://gallery.art101.io/collection/${contractName}/${row.token_id}/thumbnail`;
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
                            url: `https://gallery.art101.io/collection/${contractName}/${row.token_id}`
                        }
                    ]
                })
            });
           
            db.run(`UPDATE events SET discord_sent = 1 WHERE contract = ? AND token_id = ? and block_number = ?`, [
                row.contract, row.token_id, row.block_number
            ]);
            console.log(`posted sale info to Discord: ${title} - ${desc} - ${imageURL}`);
            await sleep(5);
        } catch(err) {
            throw new Error(`[!] Failed to post to Discord: ${err}`);
        }
    }
    });
}

function shortenAddress(address) {
  const shortAddress = `${address.slice(0, 6)}...${address.slice(address.length - 4, address.length)}`;
  if (address.startsWith('0x')) return shortAddress;
  return address;
}

async function sleep(sec) {
  return new Promise((resolve) => setTimeout(resolve, Number(sec) * 1000));
}

(() => {
    processMessages();
})();
