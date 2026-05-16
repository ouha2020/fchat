-- Remove stale send_message overloads so PostgREST can resolve the RPC by name.

drop function if exists send_message(
  uuid, text, text, text, text, text, int,
  double precision, double precision, text, text, text, text, text, text
);