Runtime: bun 1.4.4; 4 vCPU; 10 repeats per rung and scenario; warm-up 2000 queries discarded.

### Scenario 1 (one caller, one connection, 20,000 queries)

| rung | wall median us/q | wall min..max | wall vs direct | wall vs previous | cpu median us/q | cpu min..max | cpu vs direct | cpu vs previous | measurable |
|---|---|---|---|---|---|---|---|---|---|
| 1-direct | 171.6 | 163.0..189.4 | - | - | 39.8 | 36.0..44.1 | - | - | (direct) |
| 2-wirecore | 189.2 | 171.6..210.0 | +10.3% | +10.3% | 51.6 | 46.4..56.4 | +29.6% | +29.6% | cpu above threshold, **inconclusive** |
| 3-transport | 183.0 | 167.5..214.8 | +6.6% | -3.3% | 50.3 | 46.1..57.8 | +26.3% | -2.5% | cpu above threshold, **inconclusive** |
| 4-coord-pool | 191.3 | 174.9..208.9 | +11.4% | +4.5% | 53.9 | 48.7..58.0 | +35.6% | +7.3% | cpu above threshold, **inconclusive** |
| 5-full | 203.1 | 183.1..223.1 | +18.3% | +6.2% | 58.7 | 55.1..69.2 | +47.4% | +8.8% | wall+cpu above threshold, **inconclusive** |

Direct rung spread (max-min)/median: wall 15.4%, cpu 20.4%. Threshold: max(3%, spread) = wall 15.4%, cpu 20.4%. **Direct spread above 15%: inconclusive in this scenario.**

### Scenario 2 (64 callers over a pool of 8, 50,000 queries)

| rung | wall median us/q | wall min..max | wall vs direct | wall vs previous | cpu median us/q | cpu min..max | cpu vs direct | cpu vs previous | measurable |
|---|---|---|---|---|---|---|---|---|---|
| 1-direct | 42.5 | 39.0..47.6 | - | - | 16.2 | 14.6..18.3 | - | - | (direct) |
| 2-wirecore | 49.2 | 42.8..54.4 | +15.7% | +15.7% | 23.5 | 20.0..26.1 | +44.9% | +44.9% | cpu above threshold, **inconclusive** |
| 3-transport | 49.8 | 45.8..56.1 | +17.0% | +1.1% | 24.3 | 21.2..27.7 | +49.6% | +3.3% | cpu above threshold, **inconclusive** |
| 4-coord-pool | 51.0 | 48.2..55.5 | +20.0% | +2.5% | 25.9 | 23.8..30.0 | +59.5% | +6.6% | cpu above threshold, **inconclusive** |
| 5-full | 55.1 | 51.2..61.4 | +29.5% | +7.9% | 29.8 | 28.1..34.7 | +83.6% | +15.1% | wall+cpu above threshold, **inconclusive** |

Direct rung spread (max-min)/median: wall 20.2%, cpu 22.9%. Threshold: max(3%, spread) = wall 20.2%, cpu 22.9%. **Direct spread above 15%: inconclusive in this scenario.**

