"use strict";

const Server = require('..').Server;
const expect = require('chai').expect;
const _ = require('lodash');

const opts = {
	bunyan: false,
	port: 10000 + Math.ceil(Math.random() * 55535)
	/* {
	 name: 'test',
	 streams: [{
	 path: '/dev/null',
	 }]
	 } */
};


describe("Custom Resolver", function () {

	it("Should contain one resolver by default", function () {

		let server = new Server(opts);
		expect(server.resolvers).to.be.an('array');
		expect(server.resolvers.length).to.be.eq(1);
		expect(server.resolvers[0].name).to.be.eq('routing');

		server.close();
	});

	it("Should register resolver with right priority", function () {
		const resolver = function () {
			return 'http://127.0.0.1:8080';
		};

		resolver.priority = 1;

		const options = _.extend({
			resolvers: resolver
		}, opts);

		let server = new Server(options);

		expect(server.resolvers.length).to.be.eq(2);
		expect(server.resolvers[0]).to.be.eql(resolver);

		server.close();


		// test when an array is sent in as resolvers.
		options.resolvers = [resolver];
		server = new Server(options);
		expect(server.resolvers.length).to.be.eq(2);
		expect(server.resolvers[0]).to.be.eql(resolver);
		server.close();

		resolver.priority = -1;
		server = new Server(options);
		expect(server.resolvers.length).to.be.eq(2);
		expect(server.resolvers[1]).to.be.eql(resolver);
		server.close();


		// test when invalid resolver is added
		options.resolvers = {};
		expect(function () {
			new Server(options)
		}).to.throw(Error);


	});


	it('Should add and remove resolver after launch', function () {

		const resolver = function () {
		};
		resolver.priority = 1;

		const server = new Server(opts);
		server.addResolver(resolver);
		expect(server.resolvers.length).to.be.eq(2);
		expect(server.resolvers[0]).to.be.eq(resolver);

		server.addResolver(resolver);
		expect(server.resolvers.length, 'Only allows uniques.').to.be.eq(2);


		server.removeResolver(resolver);
		expect(server.resolvers.length).to.be.eq(1);
		expect(server.resolvers[0].name).to.be.eq('routing');

		server.close();

	});


	it('Should properly convert and cache route to routeObject', function () {

		const builder = Server.buildRoute;

		// invalid input
		expect(builder(function () {
		})).to.be.null;
		expect(builder([])).to.be.null;
		expect(builder(2016)).to.be.null;

		const testRoute = {urls: [], path: '/'};
		const testRouteResult = builder(testRoute);
		expect(testRouteResult, 'For route in the default format').to.be.eq(testRoute);
		expect(testRouteResult.isResolved).to.be.undefined;


		// case string:
		const testString = 'http://127.0.0.1:8888';
		const result = builder(testString);
		expect(result.path).to.be.eq('/');
		expect(result.urls).to.be.an('array');
		expect(result.urls.length).to.be.eq(1);
		expect(result.urls[0].hostname).to.be.eq('127.0.0.1');
		expect(result.isResolved).to.be.true;


		const result2 = builder(testString);
		expect(result2).to.be.eq(result);

		// case with object

		const testObject_1 = {path: '/api', url: 'http://127.0.0.1'},
			testObjectResult_1 = builder(testObject_1);

		expect(testObjectResult_1.path).to.be.eq('/api');
		expect(testObjectResult_1.urls).to.be.an('array');
		expect(testObjectResult_1.urls.length).to.be.eq(1);
		expect(testObjectResult_1.urls[0].hostname).to.be.eq('127.0.0.1');
		expect(testObjectResult_1.isResolved).to.be.true;


		// test object caching.
		const testObjectResult_2 = builder(testObject_1);
		expect(testObjectResult_1).to.be.eq(testObjectResult_2);

		const testObject_2 = {url: ['http://127.0.0.1', 'http://123.1.1.1']}
		const testResult2 = builder(testObject_2);
		expect(testResult2.urls).to.not.be.undefined;
		expect(testResult2.urls.length).to.be.eq(testObject_2.url.length);
		expect(testResult2.urls[0].hostname).to.be.eq('127.0.0.1');
		expect(testResult2.urls[1].hostname).to.be.eq('123.1.1.1');


	});

	it("Should resolve properly as expected", function () {

		let proxy = new Server(opts), resolver = function (host, url) {
			return url.match(/\/ignore/i) ? null : 'http://172.12.0.1/home'
		}, result;

		resolver.priority = 1;

		proxy.register('mysite.example.com', 'http://127.0.0.1:9999');
		proxy.addResolver(resolver);

		result = proxy.resolve('randomsite.example.com', '/anywhere');

		// must match the resolver
		expect(result).to.not.be.null;
		expect(result).to.not.be.undefined;
		expect(result.urls.length).to.be.above(0);
		expect(result.urls[0].hostname).to.be.eq('172.12.0.1');

		// expect route to match resolver even though it matches registered address
		result = proxy.resolve('mysite.example.com', '/somewhere');
		expect(result.urls[0].hostname).to.be.eq('172.12.0.1');

		// use default resolver, as custom resolver should ignore input.
		result = proxy.resolve('mysite.example.com', '/ignore');
		expect(result.urls[0].hostname).to.be.eq('127.0.0.1');


		// make custom resolver low priority and test.
		// result should match default resolver
		resolver.priority = -1;
		proxy.addResolver(resolver);
		result = proxy.resolve('mysite.example.com', '/somewhere');
		expect(result.urls[0].hostname).to.be.eq('127.0.0.1');


		// both custom and default resolvers should ignore
		result = proxy.resolve('somesite.example.com', '/ignore');
		expect(result).to.be.undefined;

		proxy.removeResolver(resolver);
		// for path-based routing
		// when resolver path doesn't match that of url, skip

		resolver = function () {
			return {
				path: '/notme',
				url: 'http://172.12.0.1/home'
			}
		};
		resolver.priority = 1;
		proxy.addResolver(resolver);

		result = proxy.resolve('somesite.example.com', '/notme');
		expect(result).to.not.be.undefined;
		expect(result.urls[0].hostname).to.be.eq('172.12.0.1');

		result = proxy.resolve('somesite.example.com', '/notme/somewhere');
		expect(result.urls[0].hostname).to.be.eq('172.12.0.1');

		result = proxy.resolve('somesite.example.com', '/itsme/somewhere');
		expect(result).to.be.undefined;


		proxy.close();
	});

});
