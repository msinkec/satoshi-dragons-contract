import { Ordinal, OrdinalNFT } from 'scrypt-ord'
import {
    method,
    prop,
    hash256,
    assert,
    ByteString,
    SigHash,
    slice,
    toByteString,
    Utils,
    PubKey,
    pubKey2Addr,
    Sig,
    len,
    int2ByteString,
} from 'scrypt-ts'
import { BlockHeader, Blockchain, MerkleProof } from 'scrypt-ts-lib'

export class SatoshiDragonsContract extends OrdinalNFT {
    @prop()
    static readonly TARGET_DIFFICULTY: bigint =
        115792089237316195423570985008687907853269984665640564039457584007913129639935n

    @prop(true)
    ownerPubKey: PubKey

    @prop(true)
    power: bigint

    // Battle related info:
    @prop(true)
    oppositeOwnerPubKey: PubKey

    @prop(true)
    oppositeDragonPower: bigint

    @prop(true)
    isChallengingPlayer: boolean

    @prop(true)
    isBattling: boolean

    constructor(ownerPubKey: PubKey) {
        super()
        this.init(...arguments)
        this.ownerPubKey = ownerPubKey
        this.power = 1n
        this.oppositeOwnerPubKey = PubKey(
            toByteString(
                '000000000000000000000000000000000000000000000000000000000000000000'
            )
        )
        this.oppositeDragonPower = 0n
        this.isChallengingPlayer = false
        this.isBattling = false
    }

    /**
     * This public method is called when P1 challenges P2.
     * The call must be made to both instances in order to count as valid.
     * In the opposite case, e.g. if a player tries to feed their dragon with
     * dummy instances, it will be deemed burned by game clients.
     * @param isChallengingPlayer
     * @param oppositeDragonPower
     */
    @method(SigHash.ANYONECANPAY_SINGLE)
    public challenge(
        isChallengingPlayer: boolean,
        oppositeOwnerPubKey: PubKey,
        oppositeDragonPower: bigint,
        sig: Sig
    ) {
        assert(this.checkSig(sig, this.ownerPubKey))

        this.isChallengingPlayer = isChallengingPlayer
        this.oppositeOwnerPubKey = oppositeOwnerPubKey
        this.oppositeDragonPower = oppositeDragonPower
        this.isBattling = true

        const outputs = this.buildStateOutputNFT()
        assert(
            this.ctx.hashOutputs == hash256(outputs),
            'hashOutputs check failed'
        )
    }

    @method()
    public battleExec(merkleProof: MerkleProof, bh: BlockHeader) {
        // Check prevouts are from same tx.
        this.checkBattlePrevouts()

        // Get entropy from BH.
        // (Commented out for easier testing...)
        //assert(
        //    Blockchain.isValidBlockHeader(
        //        bh, SatoshiDragonsContract.TARGET_DIFFICULTY
        //    ),
        //    'invalid block header'
        //)
        //assert(
        //    Blockchain.txInBlock(
        //        Sha256(this.ctx.utxo.outpoint.txid), bh, merkleProof, 32
        //    ),
        //    'invalid merkle proof'
        //)
        const rand = Blockchain.blockHeaderHashAsInt(bh)

        // Calculate battle results.
        const pP1 = 100n * this.power
        const pP2 = 100n * this.oppositeDragonPower
        const pick = rand % (pP1 + pP2)
        const won = this.isChallengingPlayer ? pick < pP1 : pick >= pP2

        // Store some info for use further down below...
        const isChallengingPlayerCurrent = this.isChallengingPlayer
        const oppositeOwnerPubKeyCurrent = this.oppositeOwnerPubKey

        // Update states and reset battle info.
        if (won) {
            this.power += 1n

            this.oppositeDragonPower = 0n
            this.isChallengingPlayer = false
            this.isBattling = false
            this.oppositeOwnerPubKey = PubKey(
                toByteString(
                    '0000000000000000000000000000000000000000000000000000000000000000'
                )
            )
        } else {
            this.oppositeDragonPower += 1n
        }

        // Outputs used in case of a win of the respective player:
        const stateOutputThisPlayer = this.buildStateOutputNFT()
        const stateOutputOppositePlayer = Utils.buildOutput(
            this.updateStateScriptPropsManually(
                Ordinal.removeInsciption(this.getStateScript()),
                this.oppositeOwnerPubKey,
                PubKey(
                    toByteString(
                        '0000000000000000000000000000000000000000000000000000000000000000'
                    )
                ),
                this.oppositeDragonPower,
                0n,
                false,
                false
            ),
            1n
        )

        // Construct and enforce subsequent outputs.
        let outputs = toByteString('')
        if (isChallengingPlayerCurrent) {
            if (won) {
                outputs += stateOutputThisPlayer // OK
                outputs += Utils.buildAddressOutput(
                    pubKey2Addr(oppositeOwnerPubKeyCurrent),
                    1n
                ) // OK
            } else {
                outputs += Utils.buildAddressOutput(
                    pubKey2Addr(this.ownerPubKey),
                    1n
                )
                outputs += stateOutputOppositePlayer
            }
        } else {
            if (won) {
                outputs += Utils.buildAddressOutput(
                    pubKey2Addr(oppositeOwnerPubKeyCurrent),
                    1n
                )
                outputs += stateOutputThisPlayer
            } else {
                outputs += stateOutputOppositePlayer
                outputs += Utils.buildAddressOutput(
                    pubKey2Addr(this.ownerPubKey),
                    1n
                )
            }
        }

        outputs += this.buildChangeOutput()

        assert(
            this.ctx.hashOutputs == hash256(outputs),
            'hashOutputs check failed'
        )
    }

    @method()
    checkBattlePrevouts(): void {
        if (this.isChallengingPlayer) {
            assert(
                this.ctx.utxo.outpoint.outputIndex == 0n,
                'wrong output index'
            )

            assert(
                this.ctx.utxo.outpoint.txid == slice(this.prevouts, 36n, 68n),
                'second input wrong txid'
            )
            assert(
                toByteString('01000000') == slice(this.prevouts, 68n, 72n),
                'second input wrong output index'
            )
        } else {
            assert(
                this.ctx.utxo.outpoint.outputIndex == 1n,
                'wrong output index'
            )

            assert(
                this.ctx.utxo.outpoint.txid == slice(this.prevouts, 0n, 32n),
                'first input wrong txid'
            )
            assert(
                toByteString('00000000') == slice(this.prevouts, 32n, 36n),
                'first input wrong output index'
            )
        }
    }

    @method()
    updateStateScriptPropsManually(
        script: ByteString,
        ownerPubKey: PubKey,
        oppositeOwnerPubKey: PubKey,
        power: bigint,
        oppositeDragonPower: bigint,
        isChallengingPlayer: boolean,
        isBattling: boolean
    ): ByteString {
        const lenTotal = len(script)
        const lenOpReturn = 80n
        const prefixScript = slice(script, 0n, lenTotal - lenOpReturn)
        return (
            prefixScript +
            toByteString('0121') +
            ownerPubKey +
            toByteString('01') +
            int2ByteString(power, 1n) + // TODO: Make larger possible
            toByteString('20') +
            oppositeOwnerPubKey +
            toByteString('01') +
            int2ByteString(oppositeDragonPower, 1n) + // TODO: Make larger possible
            (isChallengingPlayer ? toByteString('01') : toByteString('00')) +
            (isBattling ? toByteString('01') : toByteString('00')) +
            toByteString('4b00000000')
        )
    }
}
