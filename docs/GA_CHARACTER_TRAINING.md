# Character-specific genetic AI training

The evaluation AI is trained as two separate co-evolving populations:

- Madoka population: fitness is computed only from games played as Madoka.
- Mami population: fitness is computed only from games played as Mami.
- Every matchup is played with Madoka first and Mami first, so seat advantage is not mixed into character fitness.
- Each population keeps its own Hall of Fame, elites, mutations, random immigrants, and strong×random crossover children.
- Validation uses fixed opponent genomes and fixed seeds that are not used for selection fitness.

## Reuse the old shared-genome run

If `models/ga/latest.json` is the old shared AI, seed both new populations from it:

```powershell
npm run ga:evolve -- --population 24 --generations 50 --opponents 8 --repeats 2 --bootstrap models/ga/latest.json --output models/ga-split
```

The bootstrap genome is copied once into each character population. After generation 0, Madoka and Mami evolve independently.

## Fresh training

```powershell
npm run ga:evolve -- --population 24 --generations 50 --opponents 8 --repeats 2 --output models/ga-split
```

Per generation, the trainer writes:

```text
models/ga-split/latest.json
models/ga-split/latest-madoka.json
models/ga-split/latest-mami.json
models/ga-split/champion-madoka-000.json
models/ga-split/champion-mami-000.json
models/ga-split/generation-000.json
models/ga-split/metrics.jsonl
```

`latest.json` is a pair bundle containing both character AIs.

## Evaluation

```powershell
npm run ga:evaluate -- models/ga-split/latest.json --games 1000 --seed 1000
```

The report shows Madoka and Mami separately and splits both by first/second seat.

You can also evaluate two individual files:

```powershell
npm run ga:evaluate -- models/ga-split/latest-madoka.json models/ga-split/latest-mami.json --games 1000 --seed 1000
```

## Resume

Resume from a generation snapshot with the same `--population` value:

```powershell
npm run ga:evolve -- --population 24 --generations 50 --opponents 8 --repeats 2 --resume models/ga-split/generation-049.json --output models/ga-split
```

## Publish to the browser game

```powershell
npm run ga:publish -- models/ga-split/latest.json
```

This rewrites `src/evolved-genome.js` with separate `madoka` and `mami` genomes. Commit that generated file to deploy the trained pair.
