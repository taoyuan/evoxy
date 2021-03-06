"use strict";

const _ = require('lodash');
const http = require('http');
const path = require('path');
const url = require('url');
const fs = require('fs');
const PromiseA = require('bluebird');
const LE = require('greenlock');
const arrify = require("arrify");
const utils = require('./utils');

const webrootPath = ':configDir/:hostname/.well-known/acme-challenge';

class Certifier {

	constructor(opts, log) {
		this.log = log || _.noop;

		this.opts = opts = Object.assign({
			path: '',
			port: 9999,
			debug: false,
			email: 'revio@email.com',
			agreeTos: true
		}, opts);

		opts.certs = opts.certs || opts.path;
		opts.prod = opts.prod || opts.production;
		opts.challengeType = opts.challengeType || opts.challenge;

		this.approvedDomains = [];

		this._initLetsEncrypt();
		this._initServer();
	}

	_initLetsEncrypt() {
		const {log} = this;
		// Storage Backend
		const {certs: configDir, debug, prod, challengeType, email, agreeTos} = this.opts;

		const store = require('le-store-certbot').create({
			privkeyPath: ':configDir/:hostname/privkey.pem',
			fullchainPath: ':configDir/:hostname/fullchain.pem',
			certPath: ':configDir/:hostname/cert.pem',
			chainPath: ':configDir/:hostname/chain.pem',

			workDir: ':configDir/letsencrypt/const/lib',
			logsDir: ':configDir/letsencrypt/const/log',

			configDir,
			webrootPath,
			debug
		});

		// ACME Challenge Handlers
		const leFsChallenge = require('le-challenge-fs').create({webrootPath, debug});

		const leSniChallenge = require('le-challenge-sni').create({debug});
		const server = prod ? LE.productionServerUrl : LE.stagingServerUrl;

		this.log.info({server, challengeType, debug}, 'Initiating Lets Encrypt');

		this.le = LE.create({
			debug,
			server,
			store,                     					// handles saving of config, accounts, and certificates
			challengeType,       								// default to this challenge type
			challenges: {
				'http-01': leFsChallenge,  				// handles /.well-known/acme-challege keys and tokens
				'tls-sni-01': leSniChallenge,
			},
			log: (...args) => log.info(...args, 'Lets encrypt debugger'),
			email,															// for approveDomains
			agreeTos,														// for approveDomains
			approveDomains: (...args) => this.approveDomains(...args)
		});
	}

	_initServer() {
		const {certs, port} = this.opts;

		this.log.info('Initializing letsencrypt local http server, path %s, port: %s', certs, port);

		// we need to proxy for example: 'example.com/.well-known/acme-challenge' -> 'localhost:port/example.com/'
		this._httpServer = http.createServer((req, res) => {
			const uri = url.parse(req.url).pathname;
			const filename = path.join(certs, uri);

			this.log.info({filename, uri}, 'LetsEncrypt CA trying to validate challenge');

			PromiseA.fromCallback(cb => fs.lstat(filename, cb)).then(stats => {
				if (stats && stats.isFile()) {
					res.writeHead(200);
					fs.createReadStream(filename, "binary").pipe(res);
				} else {
					res.writeHead(404, {"Content-Type": "text/plain"});
					res.write("404 Not Found\n");
					res.end();
				}
			}).catch(() => {
				res.writeHead(404, {"Content-Type": "text/plain"});
				res.write("404 Not Found\n");
				res.end();
			});

		}).listen(port);
	}

	addDomain(domain) {
		if (_.isString(domain) && !this.approvedDomains.includes(domain)) {
			this.approvedDomains.push(domain);
		}
	}

	approveDomains(lexOpts, certs, cb) {
		const {le, approvedDomains} = this;
		if (!(le.email && le.agreeTos)) {
			throw new Error("le-sni-auto is not properly configured.");
		}
		if (lexOpts.domains.every(domain => approvedDomains.includes(domain))) {
			lexOpts.domains = approvedDomains.slice(0);
			lexOpts.email = le.email;
			lexOpts.agreeTos = le.agreeTos;
			return cb(null, {options: lexOpts, certs: certs});
		}
		this.log.warn('unapproved domain', lexOpts.domains, approvedDomains);
		cb(new Error("unapproved domain"));
	}

	/**
	 *  Fetch the certificates for the given domain.
	 *  Handles all the LetsEncrypt protocol. Uses
	 *  existing certificates if any, or negotiates a new one.
	 *  Returns a promise that resolves to an object with the certificates.
	 *  TODO: We should use something like https://github.com/PaquitoSoft/memored/blob/master/index.js
	 *  to avoid
	 */
	fetch(domain, email, opts) {
		opts = Object.assign({}, this.opts, opts);
		const domains = arrify(domain);
		const {challengeType, renew} = opts;

		// Check in-memory cache of certificates for the named domain
		return this.le.check({domains}).then(cert => {
			const options = {
				domains: [domain],
				email,
				agreeTos: true,
				rsaKeySize: 2048,           // 2048 or higher
				challengeType               // http-01, tls-sni-01, or dns-01
			};

			if (cert) {
				if (renew) {
					this.log.info('Renewing cert for %s', domain);
					options.duplicate = true;
					return this.le.renew(options, cert).catch(err => {
						this.log.error(err, 'Error renewing certificates for %s', domain);
					});
				} else {
					this.log.info('Using cached cert for %s', domain);
					return cert;
				}
			} else {
				// Register Certificate manually
				this.log.info('Manually registering certificate for %s', domain);
				return this.le.register(options).catch(err => {
					this.log.error(err, 'Error registering LetsEncrypt certificates');
				});
			}
		});
	}
}

module.exports = Certifier;
