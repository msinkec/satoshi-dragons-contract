import { use } from 'chai'
import { SatoshiDragonsContract } from '../src/contracts/satoshiDragonsContract'
import { getDefaultSigner } from './utils/txHelper'
import {
    MethodCallOptions,
    PubKey,
    Sha256,
    SmartContract,
    StatefulNext,
    Utils,
    bsv,
    fill,
    findSig,
    pubKey2Addr,
    reverseByteString,
    toByteString,
} from 'scrypt-ts'
import chaiAsPromised from 'chai-as-promised'
import { myPublicKey } from './utils/privateKey'
import { BlockHeader, Blockchain, MerklePath, MerkleProof } from 'scrypt-ts-lib'
use(chaiAsPromised)

describe('Test SmartContract `SatoshiDragonsContract`', () => {
    const dragon0Signer = getDefaultSigner()
    const dragon1Signer = getDefaultSigner()

    let dragon0: SatoshiDragonsContract
    let dragon1: SatoshiDragonsContract

    let deployTxDragon0: bsv.Transaction
    let deployTxDragon1: bsv.Transaction

    before(async () => {
        await SatoshiDragonsContract.loadArtifact()

        dragon0 = new SatoshiDragonsContract(PubKey(myPublicKey.toByteString()))
        await dragon0.connect(dragon0Signer)

        dragon1 = new SatoshiDragonsContract(PubKey(myPublicKey.toByteString()))
        await dragon1.connect(dragon1Signer)

        // Deploy dragon #0
        deployTxDragon0 = await dragon0.inscribeText('Dragon #0')
        console.log(`Deployed dragon #0: ${deployTxDragon0.id}`)

        // Deploy dragon #1
        deployTxDragon1 = await dragon1.inscribeText('Dragon #1')
        console.log(`Deployed dragon #1: ${deployTxDragon1.id}`)
    })

    it('challenge', async () => {
        // Dragon #0 challenges dragon #1 by constructing a PSBT
        const dragon0Next = dragon0.next()
        dragon0Next.isChallengingPlayer = true
        dragon0Next.oppositeOwnerPubKey = dragon1.ownerPubKey
        dragon0Next.oppositeDragonPower = dragon1.power
        dragon0Next.isBattling = true

        const dragon1Next = dragon1.next()
        dragon1Next.isChallengingPlayer = false
        dragon1Next.oppositeOwnerPubKey = dragon0.ownerPubKey
        dragon1Next.oppositeDragonPower = dragon0.power
        dragon1Next.isBattling = true

        dragon0.bindTxBuilder(
            'challenge',
            async (
                current: SatoshiDragonsContract,
                options: MethodCallOptions<SatoshiDragonsContract>
            ) => {
                const unsignedTx: bsv.Transaction = new bsv.Transaction()
                    .addInput(current.buildContractInput())
                    .addInput(
                        new bsv.Transaction.Input({
                            prevTxId: deployTxDragon1.id,
                            outputIndex: 1,
                            script: bsv.Script.fromHex('00'.repeat(1000)), // Dummy script
                        }),
                        deployTxDragon1.outputs[0].script,
                        1
                    )
                    .addOutput(
                        new bsv.Transaction.Output({
                            script: dragon0Next.lockingScript,
                            satoshis: 1,
                        })
                    )
                    .addOutput(
                        new bsv.Transaction.Output({
                            script: dragon1Next.lockingScript,
                            satoshis: 1,
                        })
                    )

                // build change output
                if (options.changeAddress) {
                    unsignedTx.change(options.changeAddress)
                }

                return Promise.resolve({
                    tx: unsignedTx,
                    atInputIndex: 0,
                    nexts: [
                        {
                            instance: dragon0Next,
                            atOutputIndex: 0,
                            balance: 1,
                        },
                        {
                            instance: dragon1Next,
                            atOutputIndex: 1,
                            balance: 1,
                        },
                    ],
                })
            }
        )

        const dragon0SignerAddr = await dragon0Signer.getDefaultAddress()
        const partialTx = await dragon0.methods.challenge(
            true,
            dragon1.ownerPubKey,
            dragon1.power,
            (sigResps) => findSig(sigResps, dragon0SignerAddr),
            {
                multiContractCall: true,
                changeAddress: dragon0SignerAddr,
                pubKeyOrAddrToSign: dragon0SignerAddr,
            } as MethodCallOptions<SatoshiDragonsContract>
        )

        // Dragon #1 accepts challange by signing PSBT
        dragon1.bindTxBuilder(
            'challenge',
            async (
                current: SatoshiDragonsContract,
                options: MethodCallOptions<SatoshiDragonsContract>
            ) => {
                if (options.partialContractTx) {
                    const unSignedTx = options.partialContractTx.tx
                    unSignedTx.inputs[1] = current.buildContractInput()

                    return Promise.resolve({
                        tx: unSignedTx,
                        atInputIndex: 1,
                        nexts: [],
                    })
                }

                throw new Error('no partialContractTx found')
            }
        )

        dragon1.from = {
            txId: deployTxDragon1.id,
            outputIndex: 0,
            script: deployTxDragon1.outputs[0].script.toHex(),
            satoshis: 1,
        }

        const dragon1SignerAddr = await dragon1Signer.getDefaultAddress()
        const finalTx = await dragon1.methods.challenge(
            false,
            dragon0.ownerPubKey,
            dragon0.power,
            (sigResps) => findSig(sigResps, dragon1SignerAddr),
            {
                multiContractCall: true,
                partialContractTx: partialTx,
                pubKeyOrAddrToSign: dragon1SignerAddr,
            } as MethodCallOptions<SatoshiDragonsContract>
        )

        const { tx: callTx, nexts } = await SmartContract.multiContractCall(
            finalTx,
            dragon1Signer
        )

        dragon0 = nexts[0].instance
        dragon1 = nexts[1].instance

        console.log('Battle challange accepted: ', callTx.id)
    })

    it('battle', async () => {
        // Once the challenge is accepted and the tx has a confirmation,
        // the battle can be executed by anyone.

        // Mock BH:
        const bh: BlockHeader = {
            version: reverseByteString(toByteString('20200000'), 4n),
            prevBlockHash: Sha256(
                reverseByteString(
                    toByteString(
                        '00000000000000000331a174d2a4256e648767cb14be8be161c6ebaa0b8b8222'
                    ),
                    32n
                )
            ),
            merkleRoot: Sha256(
                reverseByteString(
                    toByteString(
                        // challangeTx.id TODO: switch back to txid
                        '0000000000000000000000000000000000000000000000000000000000000000'
                    ),
                    32n
                )
            ),
            time: 1690000000n,
            bits: reverseByteString(toByteString('00000000'), 4n),
            nonce: 0x00000000n,
        }

        const merkleProof: MerkleProof = fill(
            // Fill with blanks:
            {
                hash: Sha256('00'.repeat(32)),
                pos: MerklePath.INVALID_NODE,
            },
            32
        )

        const battleExecTxBuilder = async (
            current: SatoshiDragonsContract,
            options: MethodCallOptions<SatoshiDragonsContract>,
            merkleProof: MerkleProof,
            bh: BlockHeader
        ) => {
            const unsignedTx: bsv.Transaction = options.partialContractTx
                ? options.partialContractTx.tx
                : new bsv.Transaction()

            unsignedTx.addInput(current.buildContractInput())

            // Calculate battle results.
            const rand = Blockchain.blockHeaderHashAsInt(bh)
            const pP1 = 100n * current.power
            const pP2 = 100n * current.oppositeDragonPower
            const pick = rand % (pP1 + pP2)
            const won = current.isChallengingPlayer ? pick < pP1 : pick >= pP2

            const nexts: StatefulNext<SatoshiDragonsContract>[] = []
            if (won) {
                const next = current.next()
                next.power += 1n

                next.oppositeDragonPower = 0n
                next.isChallengingPlayer = false
                next.isBattling = false
                next.oppositeOwnerPubKey = PubKey(
                    toByteString(
                        '0000000000000000000000000000000000000000000000000000000000000000'
                    )
                )

                unsignedTx.addOutput(
                    new bsv.Transaction.Output({
                        script: next.lockingScript,
                        satoshis: 1,
                    })
                )
                nexts.push({
                    instance: next,
                    balance: 1,
                    atOutputIndex: 0,
                })
            } else {
                unsignedTx.addOutput(
                    new bsv.Transaction.Output({
                        script: bsv.Script.fromHex(
                            Utils.buildPublicKeyHashScript(
                                pubKey2Addr(current.ownerPubKey)
                            )
                        ),
                        satoshis: 1,
                    })
                )
            }

            // build change output
            if (options.changeAddress) {
                unsignedTx.change(options.changeAddress)
            }

            return Promise.resolve({
                tx: unsignedTx,
                atInputIndex: current.isChallengingPlayer ? 0 : 1,
                nexts,
            })
        }

        dragon0.bindTxBuilder('battleExec', battleExecTxBuilder)

        const partialTx = await dragon0.methods.battleExec(merkleProof, bh, {
            multiContractCall: true,
            changeAddress: await dragon1Signer.getDefaultAddress(),
        } as MethodCallOptions<SatoshiDragonsContract>)

        dragon1.bindTxBuilder('battleExec', battleExecTxBuilder)

        const finalTx = await dragon1.methods.battleExec(merkleProof, bh, {
            multiContractCall: true,
            partialContractTx: partialTx,
        } as MethodCallOptions<SatoshiDragonsContract>)

        const { tx: callTx } = await SmartContract.multiContractCall(
            finalTx,
            dragon1Signer
            //{
            //    autoPayFee: false
            //} as MultiContractCallOptions
        )

        console.log('Battle executed: ', callTx.id)
    })
})
