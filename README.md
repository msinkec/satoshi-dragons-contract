# Satoshi Dragons

## A smart contract-enforced NFT game on Bitcoin

Satoshi Dragons is a Bitcoin-based game where a collection of NFTs, namely the dragons, perform smart contract-enforced interactions. This is achieved by combining the [1Sat token protocol](https://docs.1satordinals.com/) with [sCrypt](https://scrypt.io) smart contracts, facilitated by the BSV flavor of Bitcoin.

Note that this repository only contains the core smart contract, which may be integrated into a front-end.

<img src="https://gist.github.com/assets/44239392/7691a1a8-6037-46b9-9b2e-6ce3edf655af" alt="dragon" width="200"/>

### How It Works

A game of Satoshi Dragons starts with a "realm" mint transaction, where dragon NFTs are created and assigned to their owners. Each dragon gets its separate 1Sat UTXO, locked by a special smart contract script. By leveraging some more advanced techniques, the smart contract enables the NFTs to interact with each other in an "on-chain" fashion.

To keep things simple, Satoshi Dragons implements a single "battle" mechanism. The outcome of this battle is determined by the dragons' respective power levels and some randomness.

An owner of one dragon can challenge another by constructing a "challenge" [PSBT](https://bitcoinops.org/en/topics/psbt/). The challenged party checks the PSBT's structure and accepts the challenge by signing and broadcasting the transaction.

Once the challenge transaction is broadcast and mined into a block, the battle can be executed via a smart contract method call. The called method implements the game mechanics. The outcome of the battle depends on the dragons' power levels. The higher it is relative to the opposing dragon, the higher the chance of winning. To keep things interesting, randomness is introduced via the block header, where the challenge transaction was mined.

![tx-diagram](https://gist.github.com/assets/44239392/7c6131d1-acb1-4ec7-bf55-8362d5ceb4a1)

### Potential Problem: Players "feeding" their own dragon

Players may "feed" their own dragons by battling their dragon against forged low-level dragons they created. To resolve this, game clients would have to index the history of a dragon to validate that it stems from the same valid genesis transaction as theirs. A better on-chain approach would be to make the smart contract validate a recursive zk-SNARK that proves the history of the NFT. However, as of this writing, there is no working implementation of a recursive SNARK verifier on Bitcoin yet.

So, for now, if it is detected that a dragon NFT has engaged in some non-valid interaction in its history, it is disqualified from the game.

## Build

```sh
npm run build
```

## Testing Locally

```sh
npm run test
```

## Run Tests on the Bitcoin Testnet

```sh
npm run test:testnet
```
