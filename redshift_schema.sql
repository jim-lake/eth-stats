
CREATE TABLE address_ledger (
    address character varying(40) NOT NULL,
    block_number integer NOT NULL,
    block_index integer NOT NULL,
    amount_wei numeric(38,0) NOT NULL
  )
  DISTKEY(address)
  SORTKEY(address,block_number,block_index)
;

CREATE TABLE block (
    block_number integer NOT NULL,
    block_hash character varying(64) NOT NULL,
    block_time timestamp without time zone NOT NULL,
    miner_address character varying(40) NOT NULL,
    block_reward_wei numeric(38,0) NOT NULL,
    parent_hash character varying(64) NOT NULL,
    block_nonce character varying(16) NOT NULL,
    block_extra_data character varying(65535)
  )
  DISTKEY(block_hash)
  SORTKEY(block_number)
;

CREATE TABLE contract (
    contract_address character varying(40) NOT NULL,
    block_number integer NOT NULL,
    block_index integer NOT NULL,
    contract_data character varying(65535),
    contract_data_hash character varying(64) NOT NULL
  )
  DISTKEY(contract_address)
  SORTKEY(block_number,block_index)
;

CREATE TABLE transaction (
    transaction_hash character varying(64) NOT NULL,
    block_number integer NOT NULL,
    block_index integer NOT NULL,
    from_address character varying(40) NOT NULL,
    from_nonce integer NOT NULL,
    to_address character varying(40) NOT NULL,
    value_wei numeric(38,0) NOT NULL,
    fee_wei numeric(38,0) NOT NULL,
    input_data character varying(65535),
    gas_limit integer NOT NULL,
    gas_used integer NOT NULL,
    gas_price numeric(38,0) NOT NULL,
    tx_success boolean DEFAULT true NOT NULL,
    is_genesis_tx boolean DEFAULT false NOT NULL,
    is_block_reward boolean DEFAULT false NOT NULL,
    is_uncle_reward boolean DEFAULT false NOT NULL
  )
  DISTKEY(to_address)
  SORTKEY(block_number,block_index)
;

CREATE TABLE uncle (
    uncle_hash character varying(64) NOT NULL,
    block_number integer NOT NULL,
    uncle_index integer NOT NULL,
    block_time timestamp without time zone NOT NULL,
    miner_address character varying(40) NOT NULL,
    block_reward_wei numeric(38,0) NOT NULL,
    parent_hash character varying(64) NOT NULL,
    block_nonce character varying(16) NOT NULL,
    block_extra_data character varying(65535)
  )
  DISTKEY(uncle_hash)
  SORTKEY(block_number,uncle_index)
;
