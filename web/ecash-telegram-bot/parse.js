const config = require('./config');
module.exports = {
    parseBlock: function (chronikBlockResponse) {
        const { blockInfo, txs } = chronikBlockResponse;
        const { hash } = blockInfo;
        const { height, numTxs } = blockInfo;

        // Parse coinbase string
        const coinbaseScript = txs[0].inputs[0].inputScript;
        const miner = module.exports.getMinerFromCoinbase(coinbaseScript);

        // Start with i=1 to skip Coinbase tx
        const parsedTxs = [];
        for (let i = 1; i < txs.length; i += 1) {
            parsedTxs.push(module.exports.parseTx(txs[i]));
        }
        return { hash, height, miner, numTxs, parsedTxs };
    },
    getMinerFromCoinbase: function (coinbaseHexString) {
        const knownMiners = config.knownMiners;
        let miner = 'unknown';
        // Iterate over known miners to find a match
        for (let i = 0; i < knownMiners.length; i += 1) {
            const testedMiner = knownMiners[i];
            const { coinbaseScript } = testedMiner;
            if (coinbaseHexString.includes(coinbaseScript)) {
                miner = testedMiner.miner;
            }
        }
        return miner;
    },
    parseTx: function (tx) {
        /*
Parse an eCash tx as returned by chronik for interesting information

Model
{ opreturn: '', isTokenTx: true, fromAddress: '', toAddress: '', isGenesisTx: true, isCoinbaseTx: true }

Assumptions
- input[0] is the sending address
- any input addresses are potential change addresses
- Assume total outputs not at input addresses are "sent" amounts
*/
        const { txid, outputs } = tx;

        let isTokenTx = false;
        let isGenesisTx = false;
        let genesisInfo = false;
        let opReturnInfo = false;

        if (tx.slpTxData !== null && typeof tx.slpTxData !== 'undefined') {
            isTokenTx = true;
            if (
                tx.slpTxData.slpMeta !== null &&
                typeof tx.slpTxData.slpMeta !== 'undefined' &&
                tx.slpTxData.genesisInfo !== null &&
                typeof tx.slpTxData.genesisInfo !== 'undefined' &&
                tx.slpTxData.slpMeta.txType === 'GENESIS'
            ) {
                isGenesisTx = true;
                genesisInfo = tx.slpTxData.genesisInfo;
            }
        }

        // Iterate over outputs to check for OP_RETURN msgs
        for (let i = 0; i < outputs.length; i += 1) {
            const thisOutput = outputs[i];
            const { value } = thisOutput;
            // Don't parse OP_RETURN values of etoken txs, this info is available from chronik
            if (value === '0' && !isTokenTx) {
                const { outputScript } = thisOutput;
                opReturnInfo = module.exports.parseOpReturn(outputScript);
            }
        }

        return { txid, isTokenTx, isGenesisTx, genesisInfo, opReturnInfo };
    },
    parseOpReturn: function (outputScript) {
        // Initialize required vars
        let app;
        let msg;

        // Determine if this is an OP_RETURN field
        const isOpReturn =
            outputScript.slice(0, 2) === config.opReturn.opReturnPrefix;
        if (!isOpReturn) {
            return false;
        }

        // Determine if this is a memo tx
        // Memo txs have a shorter prefix and require special processing
        const isMemoTx =
            outputScript.slice(2, 6) === config.opReturn.memo.prefix;
        if (isMemoTx) {
            // memo txs require special processing
            // Send the unprocessed remainder of the string to a specialized function
            return module.exports.parseMemoOutputScript(outputScript);
        }

        // Parse for app prefix
        // See https://github.com/Bitcoin-ABC/bitcoin-abc/blob/master/web/standards/op_return-prefix-guideline.md
        const hasAppPrefix =
            outputScript.slice(2, 4) ===
            config.opReturn.opReturnAppPrefixLength;

        if (hasAppPrefix) {
            appPrefix = outputScript.slice(4, 12);
            if (Object.keys(config.opReturn.appPrefixes).includes(appPrefix)) {
                app = config.opReturn.appPrefixes[appPrefix];
            } else {
                app = 'unknown app';
            }
            switch (app) {
                case 'Cashtab Msg':
                    // For a Cashtab msg, the rest of the string will be parsed as an OP_RETURN msg
                    msg = module.exports.hexOpReturnToUtf8(
                        outputScript.slice(12),
                    );
                    break;
                case 'Alias':
                    // For an Alias Registration, the rest of the string will be parsed as an OP_RETURN msg
                    msg = module.exports.hexOpReturnToUtf8(
                        outputScript.slice(12),
                    );
                    break;
                case 'unknown':
                    // Parse the whole string less the 6a prefix, so we can see the unknown app prefix
                    msg = module.exports.hexOpReturnToUtf8(
                        outputScript.slice(2),
                    );
                    break;
                default:
                    // Parse the whole string less the 6a prefix, so we can see the unknown app prefix
                    msg = module.exports.hexOpReturnToUtf8(
                        outputScript.slice(2),
                    );
            }
        } else {
            app = 'no app';
            msg = module.exports.hexOpReturnToUtf8(outputScript.slice(2));
        }

        return { app, msg };
    },
    hexOpReturnToUtf8: function (hexStr) {
        /*
        Accept as input an OP_RETURN hex string less the 6a prefix
        String will have the form of 4c+bytelength+msg (? + 4c + bytelength + msg)
        */
        let hexStrLength = hexStr.length;
        let opReturnMsgArray = [];
        for (let i = 0; hexStrLength !== 0; i++) {
            // Check first byte for the message length or 4c + message length
            let byteValue = hexStr.slice(0, 2);
            let msgByteSize = 0;
            if (byteValue === config.opReturn.opPushDataOne) {
                // If this byte is 4c, then the next byte is the message byte size.
                // Retrieve the message byte size and convert from hex to decimal
                msgByteSize = parseInt(hexStr.substring(2, 4), 16);
                // Remove 4c + message byte size info from the beginning of hexStr
                hexStr = hexStr.slice(4);
            } else {
                // This byte is the length of an upcoming msg
                msgByteSize = parseInt(hexStr.substring(0, 2), 16);
                // Remove message byte size info from the beginning of hexStr
                hexStr = hexStr.slice(2);
            }
            // Use msgByteSize to parse the message
            const msgCharLength = 2 * msgByteSize;
            message = hexStr.slice(0, msgCharLength);

            // Add to opReturnMsgArray
            opReturnMsgArray.push(Buffer.from(message, 'hex').toString('utf8'));

            // strip out the parsed message
            hexStr = hexStr.slice(msgCharLength);
            hexStrLength = hexStr.length;

            // Sometimes OP_RETURN will have a series of msgs
            // Return to beginning of loop with i=0 if there hexStr still has remaining unparsed characters
        }
        // If there are multiple messages, for example an unknown prefix, signify this with the | character
        return opReturnMsgArray.join('|');
    },
    parseMemoOutputScript: function (memoHexStr) {
        // Remove the memo prefix, already processed
        memoHexStr = memoHexStr.slice(6);
        // At the beginning of this function, we have already popped off '0d6d'
        let app = config.opReturn.memo.app;
        let msg = '';
        for (let i = 0; memoHexStr !== 0; i++) {
            // Get the memo action code
            // See https://memo.cash/protocol
            const actionCode = memoHexStr.slice(0, 2);
            // Remove actionCode from memoHexStr
            memoHexStr = memoHexStr.slice(2);
            switch (actionCode) {
                case '01' || '02' || '05' || '0a' || '0c' || '0d' || '0e':
                    // Action codes where the entire string may be parsed to utf8
                    msg += `${
                        config.opReturn.memo[actionCode]
                    }|${module.exports.hexOpReturnToUtf8(memoHexStr)}`;
                    break;
                default:
                    // parse the rest of the string like a normal op_return utf8 string
                    msg += `${
                        Object.keys(config.opReturn.memo).includes(actionCode)
                            ? config.opReturn.memo[actionCode]
                            : ''
                    }|${module.exports.hexOpReturnToUtf8(memoHexStr)}`;
            }
            return { app, msg };
        }
    },
    prepareStringForTelegramHTML: function (string) {
        /*
        See "HTML Style" at https://core.telegram.org/bots/api

        Replace < with &lt;
        Replace > with &gt;
        Replace & with &amp;
      */
        let tgReadyString = string;
        // need to replace the '&' characters first
        tgReadyString = tgReadyString.replace(/&/g, '&amp;');
        tgReadyString = tgReadyString.replace(/</g, '&lt;');
        tgReadyString = tgReadyString.replace(/>/g, '&gt;');

        return tgReadyString;
    },
    getBlockTgMessage: function (parsedBlock) {
        const { hash, height, miner, numTxs, parsedTxs } = parsedBlock;

        // Iterate over parsedTxs to find anything newsworthy
        let tokenTxCount = 0;
        let genesisTxCount = 0;
        let opReturnTxCount = 0;
        const genesisInfoArray = [];
        const opReturnInfoArray = [];

        for (let i = 0; i < parsedTxs.length; i += 1) {
            const thisParsedTx = parsedTxs[i];
            const { txid, isTokenTx, isGenesisTx, genesisInfo, opReturnInfo } =
                thisParsedTx;
            if (isTokenTx) {
                tokenTxCount += 1;
                if (isGenesisTx) {
                    genesisTxCount += 1;

                    // Add txid to genesisInfo array as tokenId
                    const tgGenesisInfo = { ...genesisInfo, tokenId: txid };
                    genesisInfoArray.push(tgGenesisInfo);
                }
            }
            if (opReturnInfo) {
                opReturnTxCount += 1;
                const tgOpReturnInfo = { ...opReturnInfo, txid };
                opReturnInfoArray.push(tgOpReturnInfo);
            }
        }
        const tgMsg =
            `<a href="${
                config.blockExplorer
            }/block/${hash}">${height}</a> | ${numTxs} tx${
                numTxs > 1 ? `s` : ''
            } | ${miner}` +
            (tokenTxCount > 0
                ? `\n\n` +
                  `${tokenTxCount} eToken tx${tokenTxCount > 1 ? `s` : ''}` +
                  (genesisTxCount > 0
                      ? `\n\n` +
                        `This block created ${genesisTxCount} new eToken${
                            tokenTxCount > 1 ? `s` : ''
                        }:` +
                        `\n\n` +
                        `${genesisInfoArray
                            .map(genesisInfo => {
                                let {
                                    tokenId,
                                    tokenTicker,
                                    tokenName,
                                    tokenDocumentUrl,
                                } = genesisInfo;
                                tokenName =
                                    module.exports.prepareStringForTelegramHTML(
                                        tokenName,
                                    );
                                tokenTicker =
                                    module.exports.prepareStringForTelegramHTML(
                                        tokenTicker,
                                    );
                                return `<a href="${config.blockExplorer}/tx/${tokenId}">${tokenName}</a> (${tokenTicker}) <a href="${tokenDocumentUrl}">[doc]</a>`;
                            })
                            .join('\n')}`
                      : '')
                : '') +
            (opReturnTxCount > 0
                ? `\n\n` +
                  `This block contained ${
                      opReturnTxCount > 1
                          ? `OP_RETURN msgs`
                          : `an OP_RETURN msg`
                  }:` +
                  `\n\n` +
                  `${opReturnInfoArray
                      .map(tgOpReturnInfo => {
                          let { app, msg, txid } = tgOpReturnInfo;
                          msg =
                              module.exports.prepareStringForTelegramHTML(msg);
                          return `<a href="${config.blockExplorer}/tx/${txid}">${app}:</a> ${msg}`;
                      })
                      .join('\n')}`
                : '');

        return tgMsg;
    },
};