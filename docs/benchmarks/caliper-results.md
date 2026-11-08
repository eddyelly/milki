# Milki — Hyperledger Caliper benchmark

Hyperledger Caliper 0.6.0 (`fabric:fabric-gateway` connector) against the Milki test network, run on
**2026-11-08**. Full HTML report: [`caliper-report.html`](./caliper-report.html). Reproduce with
`benchmarks/caliper/run.sh` (see its header).

## Setup

| | |
|---|---|
| Fabric | 2.5.16, Raft (1 orderer), CouchDB state DB, 3 orgs × 1 peer |
| Channel / chaincode | `land-channel` / `land-registry` v1.3 (TypeScript, Node) |
| Endorsement policy | `AND('Org1MSP.peer', OR('Org2MSP.peer','Org3MSP.peer'))` |
| Client | Caliper peer-gateway connector, 2 workers, identity `caliper-registrar` (Org1, role REGISTRAR) |
| Host | 4 vCPU, 15 GB RAM, all containers on one Docker host (development sandbox) |
| Data | ~500 parcels on the ledger (demo seed + earlier benchmark writes) |

## Results

| Round | Workload | Succ | Fail | Send rate (TPS) | Avg latency (s) | Max latency (s) | Throughput (TPS) |
|---|---|---:|---:|---:|---:|---:|---:|
| GetParcel | point read (QR verify / partner API) | 3002 | 0 | 100.1 | 0.01 | 0.05 | 100.0 |
| GetParcel-peak | point read, high load | 11993 | 0 | 399.8 | 0.01 | 0.13 | 399.7 |
| GetParcelHistory | key history (ownership chain) | 1502 | 0 | 50.1 | 0.01 | 0.04 | 50.1 |
| QueryParcels | CouchDB rich query (region + status) | 752 | 0 | 25.1 | 0.03 | 0.08 | 25.0 |
| RegisterParcel-10tps | ledger write (endorse → order → commit) | 150 | 0 | 10.1 | 0.54 | 1.01 | 10.0 |
| RegisterParcel-25tps | ledger write | 250 | 0 | 25.2 | 0.38 | 0.62 | 24.4 |
| RegisterParcel-peak | ledger write, high load | 500 | 0 | 60.2 | 5.03 | 6.75 | 35.3 |

**Reading the numbers**

- **Reads** (evaluate on one peer) stay at ~10 ms average up to 400 TPS offered — the QR verification and partner
  "verify ownership" paths are not a bottleneck.
- **Writes** need endorsement from two organisations, Raft ordering and a CouchDB commit. Latency stays under
  1 s up to 25 TPS; around **35 TPS** the network saturates (latency climbs to ~5 s while throughput flattens).
  A national land registry processes far fewer transfers than that per second, so the ledger itself is not the
  limit — and in production each organisation would run several peers on separate hosts.
- Block cutting (`BatchTimeout` 2 s, `MaxMessageCount` 10 in the test network) dominates write latency at low
  load; tuning it is the first lever for lower latency.

## Finding: a missing compound index (fixed in chaincode v1.3)

The first benchmark run showed `QueryParcels` failing with `DEADLINE_EXCEEDED` (707 of 752 failed, 18.8 s average
latency) once a few hundred parcels existed, and writes queued behind the slow queries (60 s latency).
CouchDB's `_explain` showed the region + status selector used the status-only index and then scanned every
ACTIVE parcel (0.47 s per query). Adding `indexParcelRegionStatus` (`[docType, region, status]`) cut the query to
0.024 s (≈20× faster) and every round passed with zero failures.

| QueryParcels (25 TPS offered) | Succ | Fail | Avg latency | Throughput |
|---|---:|---:|---:|---:|
| Before (v1.2, status index) | 45 | 707 | 18.75 s | 8.4 TPS |
| After (v1.3, compound index) | 752 | 0 | 0.03 s | 25.0 TPS |
