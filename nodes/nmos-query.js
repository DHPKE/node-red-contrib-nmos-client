const axios = require('axios');

module.exports = function(RED) {
    function NMOSQueryNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        this.registry = RED.nodes.getNode(config.registry);
        this.resourceType = config.resourceType || 'devices';
        
        if (!this.registry) {
            node.error("No NMOS registry configured");
            node.status({fill: "red", shape: "ring", text: "no config"});
            return;
        }
        
        // RQL encoding functions (from nmos-js)
        const encodeRQLNameChars = (str) => {
            return encodeURIComponent(str.toString()).replace(/[!'()]/g, c => {
                return '%' + c.charCodeAt(0).toString(16);
            });
        };
        
        const encodeRQLKeyValueFilter = (key, value) => {
            const values = Array.isArray(value) ? value : [value];
            const terms = [];
            
            for (const val of values) {
                if (typeof val === 'string' && val.length > 0) {
                    const encodedValue = encodeRQLNameChars(val);
                    terms.push(`matches(${key},string:${encodedValue},i)`);
                } else if (typeof val === 'boolean') {
                    terms.push(`eq(${key},${encodeRQLNameChars(val)})`);
                } else if (typeof val === 'number' && !isNaN(val)) {
                    terms.push(`eq(${key},${encodeRQLNameChars(val)})`);
                }
            }
            
            if (terms.length > 1) {
                return `or(${terms.join(',')})`;
            } else if (terms.length === 1) {
                return terms[0];
            }
            return null;
        };
        
        const encodeBasicKeyValueFilter = (key, value) => {
            if (typeof value === 'string' && value.length > 0) {
                return `${key}=${encodeURIComponent(value)}`;
            } else if (typeof value === 'boolean' || typeof value === 'number') {
                return `${key}=${encodeURIComponent(value)}`;
            }
            return null;
        };
        
        const buildQueryString = (filter, useRql) => {
            const queryParams = [];
            
            if (!filter || Object.keys(filter).length === 0) {
                return '';
            }
            
            if (useRql) {
                const matchParams = [];
                for (const [key, value] of Object.entries(filter)) {
                    const param = encodeRQLKeyValueFilter(key, value);
                    if (param) matchParams.push(param);
                }
                
                if (matchParams.length > 1) {
                    queryParams.push(`query.rql=and(${matchParams.join(',')})`);
                } else if (matchParams.length === 1) {
                    queryParams.push(`query.rql=${matchParams[0]}`);
                }
            } else {
                for (const [key, value] of Object.entries(filter)) {
                    const param = encodeBasicKeyValueFilter(key, value);
                    if (param) queryParams.push(param);
                }
            }
            
            return queryParams.length > 0 ? '?' + queryParams.join('&') : '';
        };
        
        const parseLinkHeader = (linkHeader) => {
            const pagination = {};
            if (!linkHeader) return pagination;
            
            for (let cursor of ['first', 'last', 'next', 'prev']) {
                const regex = new RegExp(`<([^>]+)>;\\s*rel="${cursor}"`);
                const match = linkHeader.match(regex);
                if (match) {
                    pagination[cursor] = match[1];
                }
            }
            return pagination;
        };
        
        node.on('input', async function(msg) {
            try {
                const resourceType = msg.resourceType || node.resourceType;
                const filter = msg.filter || (msg.payload && msg.payload.filter) || {};
                const paginationURL = msg.paginationURL || (msg.payload && msg.payload.paginationURL);
                
                let url;
                if (paginationURL) {
                    url = paginationURL;
                } else {
                    const baseUrl = `${node.registry.getQueryApiUrl()}/${resourceType}/`;
                    const queryString = buildQueryString(filter, node.registry.useRql);
                    url = baseUrl + queryString;
                    
                    const separator = queryString ? '&' : '?';
                    url += `${separator}paging.limit=${node.registry.pagingLimit}`;
                    
                    if (resourceType !== 'logs') {
                        url += '&paging.order=update';
                    }
                }
                
                node.status({fill: "blue", shape: "dot", text: "querying..."});
                
                const response = await axios.get(url, {
                    headers: node.registry.getAuthHeaders(),
                    timeout: 30000,
                    validateStatus: function (status) {
                        return status >= 200 && status < 500;
                    }
                });
                
                if (response.status !== 200) {
                    throw new Error(`HTTP ${response.status}: ${response.data.error || response.statusText}`);
                }
                
                const pagination = parseLinkHeader(response.headers['link']);
                const resultCount = Array.isArray(response.data) ? response.data.length : 0;
                
                msg.payload = {
                    data: response.data,
                    total: resultCount,
                    pagination: pagination,
                    resourceType: resourceType
                };
                msg.statusCode = response.status;
                msg.headers = response.headers;
                msg.url = url;
                
                node.status({
                    fill: "green", 
                    shape: "dot", 
                    text: `${resultCount} ${resourceType}`
                });
                
                node.send(msg);
                
            } catch (error) {
                node.status({fill: "red", shape: "ring", text: "error"});
                
                let errorMsg = error.message;
                if (error.response) {
                    errorMsg = `HTTP ${error.response.status}: ${error.response.data.error || error.response.statusText}`;
                    msg.statusCode = error.response.status;
                    msg.payload = {
                        error: error.response.data,
                        statusCode: error.response.status
                    };
                } else if (error.code === 'ECONNREFUSED') {
                    errorMsg = `Connection refused: ${node.registry.registryUrl}`;
                    msg.payload = { error: errorMsg };
                } else {
                    msg.payload = { error: error.message };
                }
                
                node.error(errorMsg, msg);
                node.send(msg);
            }
        });
    }
    
    RED.nodes.registerType("nmos-query", NMOSQueryNode);
};