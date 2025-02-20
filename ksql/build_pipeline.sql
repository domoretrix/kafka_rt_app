-- STREAMS

-- CREATE BRONZE STREAM
CREATE STREAM RAW_ASSET_PRICE_STREAM ( 
  bid DOUBLE,
  ask DOUBLE,
  last DOUBLE,
  volume STRUCT<
    BTC DOUBLE,
    USD DOUBLE,
    timestamp BIGINT
  >
) WITH (
  VALUE_FORMAT='JSON',
  KAFKA_TOPIC='RAW_ASSET_PRICE_TOPIC',
  PARTITIONS=1,
  REPLICAS=3
);

-- CREATE SILVER STREAM
CREATE STREAM ASSET_PRICE_STREAM
WITH (
    TIMESTAMP='TIMESTAMP',
    KAFKA_TOPIC='ASSET_PRICE_TOPIC'
) AS 
SELECT 
  'BTC-USD' AS ticker,
  last as price,
  volume->timestamp AS TIMESTAMP
FROM RAW_ASSET_PRICE_STREAM 
PARTITION BY 'BTC-USD'
EMIT CHANGES;

-- TABLES

-- PUSH TABLES THAT WILL CREATE AN EVENT WITH EACH CHANGE IN AGGREGATION
-- minute
CREATE TABLE STATS_1M_PUSH_TABLE
WITH (
    VALUE_FORMAT='JSON_SR',
    KAFKA_TOPIC='STATS_1M'
    ) AS
SELECT ticker,
  AS_VALUE(ticker) AS `tick`,
  WINDOWSTART AS `ts`,
  MIN(price) AS `low`, 
  MAX(price) AS `high`,
  EARLIEST_BY_OFFSET(price) AS `open`,
  LATEST_BY_OFFSET(price) AS `close`,
  AVG(price) AS `intra_avg`
FROM ASSET_PRICE_STREAM
WINDOW TUMBLING(SIZE 1 MINUTE) --GRACE PERIOD 24 HOURS DEFAULT
GROUP BY ticker
EMIT CHANGES;


-- 5 min
CREATE TABLE STATS_5M_PUSH_TABLE
WITH (
    VALUE_FORMAT='JSON_SR', /* registering value json schema to schema registry */
    KAFKA_TOPIC='STATS_5M'
    ) AS
SELECT ticker,
  AS_VALUE(ticker) AS `tick`,
  WINDOWSTART AS `ts`,
  MIN(price) AS `low`, 
  MAX(price) AS `high`,
  EARLIEST_BY_OFFSET(price) AS `open`,
  LATEST_BY_OFFSET(price) AS `close`,
  AVG(price) AS `intra_avg`
FROM ASSET_PRICE_STREAM
WINDOW TUMBLING(SIZE 5 MINUTES) --GRACE PERIOD 24 HOURS DEFAULT
GROUP BY ticker
EMIT CHANGES;

-- 30 min
CREATE TABLE STATS_30M_PUSH_TABLE
WITH (
    VALUE_FORMAT='JSON_SR',
    KAFKA_TOPIC='STATS_30M'
    ) AS
SELECT ticker,
  AS_VALUE(ticker) AS `tick`,
  WINDOWSTART AS `ts`,
  MIN(price) AS `low`, 
  MAX(price) AS `high`,
  EARLIEST_BY_OFFSET(price) AS `open`,
  LATEST_BY_OFFSET(price) AS `close`,
  AVG(price) AS `intra_avg`
FROM ASSET_PRICE_STREAM
WINDOW TUMBLING(SIZE 30 MINUTES) --GRACE PERIOD 24 HOURS DEFAULT
GROUP BY ticker
EMIT CHANGES;

-- 60 min
CREATE TABLE STATS_60M_PUSH_TABLE
WITH (
    VALUE_FORMAT='JSON_SR',
    KAFKA_TOPIC='STATS_60M'
    ) AS
SELECT ticker,
  AS_VALUE(ticker) AS `tick`,
  WINDOWSTART AS `ts`,
  MIN(price) AS `low`, 
  MAX(price) AS `high`,
  EARLIEST_BY_OFFSET(price) AS `open`,
  LATEST_BY_OFFSET(price) AS `close`,
  AVG(price) AS `intra_avg`
FROM ASSET_PRICE_STREAM
WINDOW TUMBLING(SIZE 60 MINUTES) --GRACE PERIOD 24 HOURS DEFAULT
GROUP BY ticker
EMIT CHANGES;


-- PULL TABLES THAT WILL CREATE AN EVENT ONCE IT'S BEEN COMPUTED
----- MOVING STATS
-- 5 min
CREATE TABLE MOVING_5M_AVG_PULL_TABLE
WITH (
    VALUE_FORMAT='JSON_SR', 
    KAFKA_TOPIC='MOVING_5M_AVG'
    ) AS
SELECT ticker,
  AS_VALUE(ticker) AS `tick`,
  WINDOWEND AS `ts`,
  AVG(price) AS `price`
FROM ASSET_PRICE_STREAM
WINDOW HOPPING(SIZE 5 MINUTES, ADVANCE BY 1 MINUTE) --GRACE PERIOD 24 HOURS DEFAULT
GROUP BY ticker
EMIT FINAL;

-- 15 min
CREATE TABLE MOVING_15M_AVG_PULL_TABLE
WITH (
    VALUE_FORMAT='JSON_SR', 
    KAFKA_TOPIC='MOVING_15M_AVG'
    ) AS
SELECT ticker,
  AS_VALUE(ticker) AS `tick`,
  WINDOWEND AS `ts`,
  AVG(price) AS `price`
FROM ASSET_PRICE_STREAM
WINDOW HOPPING(SIZE 15 MINUTES, ADVANCE BY 1 MINUTE) --GRACE PERIOD 24 HOURS DEFAULT
GROUP BY ticker
EMIT FINAL;

-- 30 min
CREATE TABLE MOVING_30M_AVG_PULL_TABLE
WITH (
    VALUE_FORMAT='JSON_SR', 
    KAFKA_TOPIC='MOVING_30M_AVG'
    ) AS
SELECT ticker,
  AS_VALUE(ticker) AS `tick`,
  WINDOWEND AS `ts`,
  AVG(price) AS `price`
FROM ASSET_PRICE_STREAM
WINDOW HOPPING(SIZE 30 MINUTES, ADVANCE BY 1 MINUTE) --GRACE PERIOD 24 HOURS DEFAULT
GROUP BY ticker
EMIT FINAL;


-- CONNECTORS
-- SOURCE CONNECTOR TO POLL ASSET PRICES FROM ENDPOINT TO KAFKA TOPIC
CREATE SOURCE CONNECTOR SOURCE_API_CONNECTOR WITH(
  'tasks.max'='1',

  'key.converter'='org.apache.kafka.connect.storage.StringConverter',
  'value.converter'='org.apache.kafka.connect.storage.StringConverter',
  'value.converter.schemas.enable'='false',

  'connector.class'='com.tm.kafka.connect.rest.RestSourceConnector',

  'rest.source.poll.interval.ms'='1000', --every second
  'rest.source.method'='GET',
  -- sorce endpoint
  'rest.source.url'='https://api.gemini.com/v1/pubticker/btcusd',
  'rest.source.headers'='Content-Type:application/json,Accept:application/json',
  'rest.source.payload.converter.class'='com.tm.kafka.connect.rest.converter.StringPayloadConverter',
  'rest.source.topic.selector'='com.tm.kafka.connect.rest.selector.SimpleTopicSelector',
  'rest.source.destination.topics'='RAW_ASSET_PRICE_TOPIC'
);

-- SINK CONNECTOR TO PUSH DATA FROM KAFKA STAT TOPICS TO MONGODB
CREATE SINK CONNECTOR SINK_MONGO_CONNECTOR WITH (
  'connector.class' ='com.mongodb.kafka.connect.MongoSinkConnector',
  /*ONE TASK PER TOPIC*/
  'tasks.max' ='7',

  'topics' ='STATS_1M,STATS_5M,STATS_30M,STATS_60M,MOVING_5M_AVG,MOVING_15M_AVG,MOVING_30M_AVG',
  'connection.uri' ='mongodb://mongo1:27017',
  'database' ='crypto-stats',

  'key.converter'='org.apache.kafka.connect.storage.StringConverter',
  'key.converter.schemas.enable'='true',
   
   -- configure value json schema from schema registry
  'value.converter'='io.confluent.connect.json.JsonSchemaConverter',
  'value.converter.schema.registry.url'='http://schema-registry:8081',
  'value.converter.schemas.enable'='true',

   --extract topic key into _id field
  'transforms'='PromoteKey,RemoveDocFields',
  'transforms.PromoteKey.type'='org.apache.kafka.connect.transforms.ValueToKey',
  'transforms.PromoteKey.fields'='tick,ts',
   --extract topic keys from value keys
  'transforms.RemoveDocFields.type'='org.apache.kafka.connect.transforms.ReplaceField$Value',
  'transforms.RemoveDocFields.exclude'='tick,ts',
  
  -- map extracted _id key to mongo _id with replacement by value and delete on null tombstone
  'document.id.strategy'='com.mongodb.kafka.connect.sink.processor.id.strategy.FullKeyStrategy',
  'writemodel.strategy'='com.mongodb.kafka.connect.sink.writemodel.strategy.ReplaceOneDefaultStrategy',
  'delete.on.null.values'='true',
  
  'errors.tolerance'='all',
  'errors.log.enable'='true',
  'errors.deadletterqueue.topic.name'='mongo-sink-errors'
);


