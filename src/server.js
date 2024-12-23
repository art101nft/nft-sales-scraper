const ALL_CONTRACTS = require('./contracts');

const Database = require('better-sqlite3');
const express = require('express');


const app = express();
const port = process.env.PORT || 3000;
const db = new Database('./state/sqlite.db', {readonly: true});


app.use(express.json());

app.use('/', express.static('public'));

app.use('/app', express.static('public'));

app.get('/api/contracts', (req, res) => {
    res.status(200).json(ALL_CONTRACTS)
})

app.get('/api/:contractAddress/events', (req, res) => {
    const results = [];
    const stmt = db.prepare(`select *
        from events
        where contract = '${req.params.contractAddress}'
        collate nocase
        order by block_number desc
        limit 100
    `);
    for (const entry of stmt.iterate()) {
        results.push(entry);
    }
    res.status(200).json(results);
});

app.get('/api/token/:contractAddress/:tokenId/history', (req, res) => {
    const results = [];
    const stmt = db.prepare(`select *
        from events
        where token_id = ${req.params.tokenId}
        and contract = '${req.params.contractAddress}'
        collate nocase
        order by block_number desc
    `);
    for (const entry of stmt.iterate()) {
        results.push(entry);
    }
    res.status(200).json(results);
});

app.get('/api/latest', (req, res) => {
    const stmt = db.prepare(`select *
        from events
        order by block_number desc
        limit 1
    `);
    res.status(200).json(stmt.get());
});

app.get('/api/:contractAddress/data', (req, res) => {
    const results = [];
    const stmt = db.prepare(`select
        block_number block,
        sum(sale_price/1000000000000000000.0) volume,
        avg(sale_price/1000000000000000000.0) average_price,
        (select avg(sale_price/1000000000000000000.0) from (select * from events
          where contract = '${req.params.contractAddress}'
          collate nocase
          order by sale_price
          limit 10)) floor_price,
        count(*) sales
    from events ev
    where contract = '${req.params.contractAddress}'
    collate nocase
    group by block
    order by block
    `);
    for (const entry of stmt.iterate()) {
        results.push(entry);
    }
    res.status(200).json(results);
});

app.get('/api/:contractAddress/platforms', (req, res) => {
    const results = [];
    const stmt = db.prepare(`select marketplace,
        sum(sale_price/1000000000000000000.0) volume,
        count(*) sales
        from events
        where contract = '${req.params.contractAddress}'
        collate nocase
        group by marketplace
        order by sum(sale_price/1000000000000000000.0) desc
    `);
    for (const entry of stmt.iterate()) {
        results.push(entry);
    }
    res.status(200).json(results);
});

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});