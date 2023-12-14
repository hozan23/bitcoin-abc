import React, { useState, useEffect } from 'react';
import { Modal } from 'antd';
import extension from 'extensionizer';
import PropTypes from 'prop-types';

const Extension = ({ wallet }) => {
    // Extension-only state fields
    const [showApproveAddressShareModal, setShowApproveAddressShareModal] =
        useState(false);
    const [addressRequestTabId, setAddressRequestTabId] = useState(null);
    const [addressRequestTabUrl, setAddressRequestTabUrl] = useState('');

    // Connect to extension messaging port
    const port = extension.runtime.connect({ name: 'cashtabPort' });
    // Extension storage get method
    const getObjectFromExtensionStorage = async function (key) {
        return new Promise((resolve, reject) => {
            try {
                extension.storage.sync.get(key, function (value) {
                    resolve(value[key]);
                });
            } catch (err) {
                reject(err);
            }
        });
    };
    const copyAddressToExtensionStorage = async wallet => {
        // Get address from active wallet
        let address;
        try {
            address = wallet.Path1899.cashAddress;
            console.log(`Address fetched from extension`, address);
        } catch (err) {
            // The wallet object can be 'false' when Cashtab first loads. In this case, we want this function to do nothing.
            return console.log(
                `Wallet not loaded yet, exiting copyAddressToExtension`,
            );
        }
        // Save the address to extension storage API

        // Check for stored value
        const storedAddress = await getObjectFromExtensionStorage(['address']);
        console.log(`storedAddress`, storedAddress);
        if (address === storedAddress) {
            // No need to store it again
            console.log(`Active wallet address already in extension storage`);
            return;
        }

        // If the address has not been set (or if the user has changed wallets since it was last set), set it
        await extension.storage.sync.set({ address: address }, function () {
            console.log(
                `Address ${address} saved to storage under key 'address'`,
            );
        });
    };

    const handleApprovedAddressShare = () => {
        console.log(`handleApprovedAddressShare called`);
        // Let the background script know you approved this request
        port.postMessage({
            type: 'FROM_CASHTAB',
            text: 'Cashtab',
            addressRequestApproved: true,
            url: addressRequestTabUrl,
            tabId: addressRequestTabId,
        });
        setShowApproveAddressShareModal(false);
        // Close the popup after user action
        window.close();
    };

    const handleRejectedAddressShare = () => {
        console.log(`handleRejectedAddressShare called`);
        // Let the background script know you denied this request
        port.postMessage({
            type: 'FROM_CASHTAB',
            text: 'Cashtab',
            addressRequestApproved: false,
            url: addressRequestTabUrl,
            tabId: addressRequestTabId,
        });
        setShowApproveAddressShareModal(false);
        // Close the popup after user action
        window.close();
    };

    useEffect(() => {
        // On wallet change
        copyAddressToExtensionStorage(wallet);
    }, [wallet]);

    useEffect(() => {
        // On load

        // Parse for query string asking for user approval of sharing extension info with a web page
        // Do not set txInfo in state if query strings are not present
        if (
            !window.location ||
            !window.location.hash ||
            window.location.hash === '#/wallet'
        ) {
            return;
        }

        try {
            let windowHash = window.location.hash;
            let queryStringArray = windowHash.split('#/wallet?');
            let queryString = queryStringArray[1];
            let queryStringParams = new URLSearchParams(queryString);
            let request = queryStringParams.get('request');
            let tabId = queryStringParams.get('tabId');
            let tabUrl = queryStringParams.get('tabUrl');
            console.log(`request`, request);
            console.log(`tabId`, tabId);
            console.log(`tabUrl`, tabUrl);
            if (request !== 'addressRequest') {
                return;
            }

            // Open a modal that asks for user approval
            setAddressRequestTabId(tabId);
            setAddressRequestTabUrl(tabUrl);
            setShowApproveAddressShareModal(true);
        } catch (err) {
            // If you can't parse this, forget about it
            return;
        }

        // Modal onApprove function should post a message that gets to background.js
    }, []);

    return (
        <>
            {showApproveAddressShareModal && (
                <Modal
                    title={`Share your address?`}
                    open={showApproveAddressShareModal}
                    onOk={() => handleApprovedAddressShare()}
                    onCancel={() => handleRejectedAddressShare()}
                >
                    <p>
                        The web page {addressRequestTabUrl} is requesting your
                        eCash address.
                    </p>
                </Modal>
            )}
        </>
    );
};

Extension.propTypes = {
    wallet: PropTypes.object | PropTypes.bool,
};

export default Extension;
