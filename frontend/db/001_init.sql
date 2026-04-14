create table if not exists tokens (
  id integer primary key check (id >= 1 and id <= 10000),
  claimed boolean not null default false,
  owner_address text,
  vessel_type text,
  filled boolean not null default false,
  payload_bytes integer not null default 0,
  capacity_bytes integer not null,
  color_mode integer,
  role integer,
  claim_block bigint,
  entry_count integer,
  chosen_entry integer,
  delegate_address text,
  machine_address text,
  chosen_machine_address text,
  details_updated_at timestamptz not null default now()
);

create index if not exists tokens_owner_address_idx on tokens (owner_address);
create index if not exists tokens_claimed_idx on tokens (claimed);
create index if not exists tokens_vessel_type_idx on tokens (vessel_type);
create index if not exists tokens_filled_idx on tokens (filled);
create index if not exists tokens_color_mode_idx on tokens (color_mode);
create index if not exists tokens_payload_bytes_idx on tokens (payload_bytes);

create table if not exists transfers (
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  token_id integer not null,
  from_address text not null,
  to_address text not null,
  timestamp timestamptz,
  primary key (tx_hash, log_index)
);

create index if not exists transfers_token_id_idx on transfers (token_id);
create index if not exists transfers_to_address_idx on transfers (to_address);
create index if not exists transfers_block_number_idx on transfers (block_number);

create table if not exists indexer_state (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
