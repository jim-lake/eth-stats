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
-- Name: public; Type: SCHEMA; Schema: -; Owner: root
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO root;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: root
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_with_oids = false;

--
-- Name: address_ledger; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.address_ledger (
    address bytea NOT NULL,
    transaction_hash bytea NOT NULL,
    transaction_order integer NOT NULL,
    amount_wei numeric(80,0) NOT NULL
);


ALTER TABLE public.address_ledger OWNER TO root;

--
-- Name: block; Type: TABLE; Schema: public; Owner: root
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


ALTER TABLE public.block OWNER TO root;

--
-- Name: contract; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.contract (
    contract_address bytea NOT NULL,
    transaction_hash bytea NOT NULL,
    contract_data bytea,
    contract_data_hash bytea NOT NULL
);


ALTER TABLE public.contract OWNER TO root;

--
-- Name: transaction; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.transaction (
    transaction_hash bytea NOT NULL,
    block_number integer NOT NULL,
    block_order integer NOT NULL,
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
);


ALTER TABLE public.transaction OWNER TO root;

--
-- Name: uncle; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.uncle (
    uncle_hash bytea NOT NULL,
    block_number integer NOT NULL,
    block_time timestamp without time zone NOT NULL,
    miner_address bytea NOT NULL,
    block_reward_wei numeric(80,0) NOT NULL,
    parent_hash bytea NOT NULL,
    block_nonce bytea NOT NULL,
    block_extra_data bytea
);


ALTER TABLE public.uncle OWNER TO root;

--
-- Name: address_ledger address_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.address_ledger
    ADD CONSTRAINT address_ledger_pkey PRIMARY KEY (transaction_hash, transaction_order);


--
-- Name: block block_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.block
    ADD CONSTRAINT block_pkey PRIMARY KEY (block_number);


--
-- Name: contract contract_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.contract
    ADD CONSTRAINT contract_pkey PRIMARY KEY (contract_address);


--
-- Name: transaction transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_pkey PRIMARY KEY (transaction_hash);


--
-- Name: uncle uncle_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.uncle
    ADD CONSTRAINT uncle_pkey PRIMARY KEY (uncle_hash);


--
-- Name: address; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX address ON public.address_ledger USING btree (address);


--
-- Name: address_ledger_transaction_hash; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX address_ledger_transaction_hash ON public.address_ledger USING btree (transaction_hash);


--
-- Name: block_hash; Type: INDEX; Schema: public; Owner: root
--

CREATE UNIQUE INDEX block_hash ON public.block USING btree (block_hash);


--
-- Name: block_number_order; Type: INDEX; Schema: public; Owner: root
--

CREATE UNIQUE INDEX block_number_order ON public.transaction USING btree (block_number, block_order);


--
-- Name: block_time; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX block_time ON public.block USING btree (block_time);


--
-- Name: contract_transaction_hash; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX contract_transaction_hash ON public.contract USING btree (transaction_hash);


--
-- Name: from_address_nonce; Type: INDEX; Schema: public; Owner: root
--

CREATE UNIQUE INDEX from_address_nonce ON public.transaction USING btree (from_address, from_nonce);


--
-- Name: to_address; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX to_address ON public.transaction USING btree (to_address);


--
-- Name: uncle_block_number; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX uncle_block_number ON public.uncle USING btree (block_number);


--
-- Name: address_ledger address_ledger_transaction_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.address_ledger
    ADD CONSTRAINT address_ledger_transaction_hash_fkey FOREIGN KEY (transaction_hash) REFERENCES public.transaction(transaction_hash) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: contract contract_transaction_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.contract
    ADD CONSTRAINT contract_transaction_hash_fkey FOREIGN KEY (transaction_hash) REFERENCES public.transaction(transaction_hash) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction transaction_block_number_fkey; Type: FK CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_block_number_fkey FOREIGN KEY (block_number) REFERENCES public.block(block_number) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: uncle uncle_block_number_fkey; Type: FK CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.uncle
    ADD CONSTRAINT uncle_block_number_fkey FOREIGN KEY (block_number) REFERENCES public.block(block_number) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

