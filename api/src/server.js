const { MongoClient, Long } = require('mongodb');
const http = require('http');
const { Server } = require('socket.io');

const uri = 'mongodb://mongo1:27017';
const dbName = 'crypto-stats';

async function run() {

    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('Connected to MongoDB');

        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Socket.IO server is running');
        });

        const io = new Server(server, {cors: {origin: '*'} });

        const rtPrice = io.of('/rt-price');
        const rtStats = io.of('/rt-stats');
        const rtMovingStats = io.of('/rt-moving-stats');

        const db = client.db(dbName);

        // real time price namespace
        rtPrice.on('connection',  async (socket) => {
            console.log('Client connected to /rt-price', socket.id);
            const collectionName = 'STATS_1M';
            const collection = db.collection(collectionName);

            let latestTs;
            try{
                //get initial latest price
                const response = await collection
                    .find({'_id.tick': 'BTC-USD'})
                    .sort({ "_id.ts": -1 })
                    .limit(1)
                    .project({   
                        ticker: "$_id.tick",
                        timestamp: "$_id.ts",
                        price: "$close", 
                    })
                    .toArray();

                const { ticker, timestamp, price } = response[0];
                latestTs = timestamp || 0;
                socket.emit('update', { ticker, price});
            } catch (err) {
                console.error('Error retrieving initial documents:', err);
                socket.emit('errorMsg', `Error retrieving initial documents: ${err.message}`);
                socket.disconnect();
                return;
            }

            const latestDocument = [
                { $match: { 
                    operationType: { $in: ["insert", "replace"] },
                    'fullDocument._id.tick': 'BTC-USD'
                    }
                },
                { $project: {
                        ticker: "$fullDocument._id.tick",
                        timestamp: "$fullDocument._id.ts",
                        price: "$fullDocument.close",
                        operationType:1
                }}
              ];
            
            const changeStream = collection.watch(latestDocument, { fullDocument: 'updateLookup' });

            changeStream.on('change', (change) => {
                
                const {_id, timestamp:newTs, ticker, price, operationType } = change;

                if (newTs > latestTs) {
                    latestTs = newTs;
                    socket.emit('update', { ticker, price});
                } else if (newTs === latestTs && operationType === 'replace') {
                    socket.emit('update', { ticker, price});
                }
            });
            

            changeStream.on('error', (err) => {
                console.error(`Change Stream error in rt-price:`, err);
                socket.emit('errorMsg', `Change Stream error: ${err.message}`);
            });


            socket.on('disconnect', () => {
                console.log(`Client disconnected from rt-price: ${socket.id}`);
                changeStream.close().catch(console.error);
            });

        });

        // real time stats namespace
        rtStats.on('connection', async (socket) => {
            console.log('Client connected to /rt-stats', socket.id);
           
            const frequencyMins = parseInt(socket.handshake.query.frequency, 10) || 1;
            const backfillMins = Math.min( parseInt(socket.handshake.query.backfill, 10) || 60, 60*2);
            const allowedFrequencies = [1, 5, 30, 60];

            if (!allowedFrequencies.includes(frequencyMins)) {
                console.log(`Rejected client: invalid data frequency ${frequencyMins}`);
                socket.emit('errorMsg', 'Invalid minutes parameter');
                socket.disconnect();
                return;
            }   
        
            const startTime = new Date(Date.now() - backfillMins * 60 * 1000);
            const collectionName = `STATS_${frequencyMins}M`;
            const collection = db.collection(collectionName);

            try {
                const initialDocs = await collection
                .find({
                    '_id.tick': 'BTC-USD',
                    '_id.ts': { $gte: Long.fromNumber(startTime.getTime()) }
                })
                .project({
                    id: { $concat: ["$_id.tick", '_', { $toString: "$_id.ts" }] },
                    timestamp: "$_id.ts",
                    ticker: "$_id.tick",
                    avg: "$intra_avg",
                    high: 1, 
                    low: 1, 
                    open: 1, 
                    close:1
                })
                .toArray();
                
                const docs = initialDocs.map( ({_id, ...restDoc}) => restDoc);
                socket.emit('init', docs);

            } catch (err) {
                console.error('Error retrieving initial documents:', err);
                socket.emit('errorMsg', `Error retrieving initial documents: ${err.message}`);
                socket.disconnect();
                return;
            }

            const latestStatsDocuments = [
                { $match: {
                    operationType: { $in: ['insert', 'update', 'delete', 'replace'] },
                    'fullDocument._id.tick': 'BTC-USD',
                    'fullDocument._id.ts': { $gte: Long.fromNumber(startTime.getTime()) }
                }},
                { $project: {
                    id: { $concat: ["$fullDocument._id.tick", "_", { $toString: "$fullDocument._id.ts" }] },
                    ticker: "$fullDocument._id.tick",
                    timestamp: "$fullDocument._id.ts",
                    avg: "$fullDocument.intra_avg",
                    high: "$fullDocument.high",
                    low: "$fullDocument.low",
                    open: "$fullDocument.open",
                    close: "$fullDocument.close",
                    operationType: 1,
                }}
            ];

            const changeStream = collection.watch(latestStatsDocuments, { fullDocument: 'updateLookup' });

            changeStream.on('change', (change) => {
                console.log(change);
                const {_id, operationType, ...restDoc} = change;
                socket.emit(operationType, restDoc);
            });


            changeStream.on('error', (err) => {
                console.error(`Change Stream error in ${collectionName}:`, err);
                socket.emit('errorMsg', `Change Stream error: ${err.message}`);
            });


            socket.on('disconnect', () => {
                console.log(`Client disconnected: ${socket.id}`);
                changeStream.close().catch(console.error);
            });
        });


        // real time moving stats namespace
        rtMovingStats.on('connection', async (socket) => {
            console.log('Client connected to /rt-moving-stats', socket.id);

            const allowedFrequencies = [5, 15, 30];
            const frequencyMins = parseInt(socket.handshake.query.frequency, 10) || allowedFrequencies[0];
            const backfillMins = Math.min( parseInt(socket.handshake.query.backfill, 10) || 60, 60*2);

            if (!allowedFrequencies.includes(frequencyMins)) {
                console.log(`Rejected client: invalid data frequency ${frequencyMins}`);
                socket.emit('errorMsg', 'Invalid minutes parameter');
                socket.disconnect();
                return;
            }

            const startTime = new Date(Date.now() - backfillMins * 60 * 1000);
            const collectionName = `MOVING_${frequencyMins}M_AVG`;
            const collection = db.collection(collectionName);

            try {
                const initialDocs = await collection
                .find({
                    '_id.tick': 'BTC-USD',
                    '_id.ts': { $gte: Long.fromNumber(startTime.getTime()) }
                })
                .project({
                    id: { $concat: ["$_id.tick", '_', { $toString: "$_id.ts" }] },
                    timestamp: "$_id.ts",
                    ticker: "$_id.tick",
                    price: 1
                })
                .toArray();
                
                const docs = initialDocs.map( ({_id, ...restDoc}) => restDoc);
                socket.emit('init', docs);

            } catch (err) {
                console.error('Error retrieving initial documents:', err);
                socket.emit('errorMsg', `Error retrieving initial documents: ${err.message}`);
                socket.disconnect();
                return;
            }

            const latestStatsDocuments = [
                { $match: {
                    operationType: { $in: ['insert', 'update', 'delete', 'replace'] },
                    'fullDocument._id.tick': 'BTC-USD',
                    'fullDocument._id.ts': { $gte: Long.fromNumber(startTime.getTime()) }
                }},
                { $project: {
                    id: { $concat: ["$fullDocument._id.tick", "_", { $toString: "$fullDocument._id.ts" }] },
                    ticker: "$fullDocument._id.tick",
                    timestamp: "$fullDocument._id.ts",
                    price: "$fullDocument.price",
                    operationType: 1,
                }}
            ];

            const changeStream = collection.watch(latestStatsDocuments, { fullDocument: 'updateLookup' });

            changeStream.on('change', (change) => {
                console.log(change);
                const {_id, operationType, ...restDoc} = change;
                socket.emit(operationType, restDoc);
            });

            changeStream.on('error', (err) => {
                console.error(`Change Stream error in ${collectionName}:`, err);
                socket.emit('errorMsg', `Change Stream error: ${err.message}`);
            });

            socket.on('disconnect', () => {
                console.log(`Client disconnected: ${socket.id}`);
                changeStream.close().catch(console.error);
            });

        });


        const PORT = 8085;
        server.listen(PORT, () => {
            console.log(`Server with Socket.IO running on http://localhost:${PORT}`);
        });

    } catch (err) {
        console.error('Error:', err);
    }
}

run();
