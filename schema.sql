--
-- PostgreSQL database dump
--

-- Dumped from database version 11.6
-- Dumped by pg_dump version 11.5

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_with_oids = false;

--
-- Name: address_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.address_ledger (
    address bytea NOT NULL,
    block_number integer NOT NULL,
    block_index integer NOT NULL,
    amount_wei numeric(80,0) NOT NULL
);


--
-- Name: block; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.block (
    block_number integer NOT NULL,
    block_hash bytea NOT NULL,
    block_time timestamp without time zone NOT NULL,
    miner_address bytea NOT NULL,
    block_reward_wei numeric(80,0) NOT NULL,
    parent_hash bytea NOT NULL,
    block_nonce bytea NOT NULL,
    block_extra_data bytea
);


--
-- Name: contract; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract (
    contract_address bytea NOT NULL,
    block_number integer NOT NULL,
    block_index integer NOT NULL,
    contract_data bytea,
    contract_data_hash bytea NOT NULL
)
WITH (autovacuum_enabled='false');


--
-- Name: etl_file; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.etl_file (
    etl_file_id bigint NOT NULL,
    create_time timestamp without time zone DEFAULT now(),
    table_name character varying(64) NOT NULL,
    start_block_number integer NOT NULL,
    end_block_number integer NOT NULL,
    s3_url character varying(1024) NOT NULL,
    is_imported boolean DEFAULT false NOT NULL
);


--
-- Name: etl_file_etl_file_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.etl_file_etl_file_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: etl_file_etl_file_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.etl_file_etl_file_id_seq OWNED BY public.etl_file.etl_file_id;


--
-- Name: transaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction (
    transaction_hash bytea NOT NULL,
    transaction_hash_prefix bytea NOT NULL,
    block_number integer NOT NULL,
    block_index integer NOT NULL,
    from_address bytea NOT NULL,
    from_nonce integer NOT NULL,
    to_address bytea NOT NULL,
    value_wei numeric(80,0) NOT NULL,
    fee_wei numeric(80,0) NOT NULL,
    input_data bytea,
    gas_limit integer NOT NULL,
    gas_used integer NOT NULL,
    gas_price numeric(80,0) NOT NULL,
    tx_success boolean DEFAULT true NOT NULL,
    is_genesis_tx boolean DEFAULT false NOT NULL,
    is_block_reward boolean DEFAULT false NOT NULL,
    is_uncle_reward boolean DEFAULT false NOT NULL
)
WITH (autovacuum_enabled='false');


--
-- Name: uncle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uncle (
    uncle_hash bytea NOT NULL,
    block_number integer NOT NULL,
    uncle_index integer NOT NULL,
    block_time timestamp without time zone NOT NULL,
    miner_address bytea NOT NULL,
    block_reward_wei numeric(80,0) NOT NULL,
    parent_hash bytea NOT NULL,
    block_nonce bytea NOT NULL,
    block_extra_data bytea
);


--
-- Name: etl_file etl_file_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etl_file ALTER COLUMN etl_file_id SET DEFAULT nextval('public.etl_file_etl_file_id_seq'::regclass);


--
-- Name: block block_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.block
    ADD CONSTRAINT block_pkey PRIMARY KEY (block_number);


--
-- Name: etl_file etl_file_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etl_file
    ADD CONSTRAINT etl_file_pkey PRIMARY KEY (etl_file_id);


--
-- Name: transaction transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_pkey PRIMARY KEY (block_number, block_index);


--
-- Name: uncle uncle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uncle
    ADD CONSTRAINT uncle_pkey PRIMARY KEY (block_number, uncle_index);


--
-- Name: address_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX address_hash ON public.address_ledger USING hash (address);


--
-- Name: address_ledger_block_number_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX address_ledger_block_number_index ON public.address_ledger USING btree (block_number, block_index);


--
-- Name: contract_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contract_address ON public.contract USING hash (contract_address);


--
-- Name: contract_block_number_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contract_block_number_index ON public.contract USING btree (block_number, block_index);


--
-- PostgreSQL database dump complete
--

