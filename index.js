'use strict';

const Trace = require('./lib/trace.js');
const vm = require('vm');
const Module = require('module');
const path = require('path');
const request = require('request');
let debugLogger;

try {
	require.resolve('json-ws');
} catch (err) {
	// Import error, make json-ws requireable (for require('json-ws/client') in proxies):
	module.paths.unshift(path.resolve(__dirname, '..'));
}

module.exports = function(logger) {
	debugLogger = logger;
	return module.exports;
};

module.exports.service = require('./lib/service/service.js');

module.exports.client = require('./lib/client.js').RpcClient;

module.exports.transport = {
	WebSocket: function(httpServer) {
		const WsTransport = require('./lib/transport/ws-transport');
		const transport = new WsTransport(httpServer);
		transport.trace.setLogger(debugLogger);
		return transport;
	},

	HTTP: function(registry) {
		const HttpTransport = require('./lib/transport/http-transport');
		const transport = new HttpTransport(registry);
		transport.trace.setLogger(debugLogger);
		return transport;
	}
};

module.exports.transport.WebSocket.type = 'WebSocket';
module.exports.transport.HTTP.type = 'HTTP';

/**
 * Fetches proxy code from a URL
 * Attempts to run the script in the VM and return to result to the caller
 * @param {String} proxyUrl
 * @param {Object} sslSettings
 * @param {Function} callback
 */
module.exports.proxy = function(proxyUrl, sslSettings, callback) {
	if (!callback) {
		callback = sslSettings;
		sslSettings = {};
	}

	request(proxyUrl, {
		agentOptions: sslSettings
	}, function(err, response, body) {
		if (err) { callback(err); return; }

		if (response.statusCode !== 200) {
			callback(new Error('Proxy not available at ' + proxyUrl));
			return;
		}

		const proxyModule = {exports: {}};

		try {
			const moduleWrapper = vm.runInThisContext(Module.wrap(body), {filename: proxyUrl});
			moduleWrapper(proxyModule.exports, require, proxyModule);
		} catch (vmError) {
			const err = new Error('Error loading proxy');
			err.stack = vmError.stack;
			callback(err);
			return;
		}

		callback(null, proxyModule.exports);
	});
};

module.exports.getClientProxy = function(apiRoot, apiType, version, sslSettings, callback) {
	if (!callback) {
		callback = sslSettings;
		sslSettings = {};
	}
	const serviceUrl = apiRoot + '/' + apiType + '/' + version;
	const proxyClassName = apiType.split(/\W+/).map(function(string) {
		return string[0].toUpperCase() + string.slice(1).toLowerCase();
	}).join('') + 'Proxy';
	const proxyUrl = serviceUrl + '?proxy=JavaScript&localName=' + proxyClassName;
	module.exports.proxy(proxyUrl, sslSettings, function(err, proxy) {
		if (err) {
			callback(err, null);
		} else {
			const ProxyClass = proxy[proxyClassName];
			if (ProxyClass) {
				callback(null, new ProxyClass(serviceUrl, sslSettings));
			} else {
				callback(new Error('Proxy not available'));
			}
		}
	});
};

/**
 * API Registry middleware for Express/Connect
 * Responds to OPTIONS request, renders a page listing all registered services
 * and serves the NodeJS/browser client library.
 * @param {String} rootPath Mount point of the service registry.
 */
module.exports.registry = function(rootPath, httpServer, expressApp) {
	const registry = require('./lib/registry');
	return registry(rootPath, httpServer, expressApp);
};

module.exports.getLanguageProxy = require('./lib/get-language-proxy');
