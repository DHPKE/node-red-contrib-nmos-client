module.exports = function(RED) {
    function NMOSConfigNode(config) {
        RED.nodes.createNode(this, config);
        
        // Store configuration
        this.name = config.name;
        this.registryUrl = config.registryUrl || 'http://localhost:8870';
        this.queryApiVersion = config.queryApiVersion || 'v1.3';
        this.connectionApiVersion = config.connectionApiVersion || 'v1.1';
        this.useRql = config.useRql !== false;
        this.pagingLimit = parseInt(config.pagingLimit) || 10;
        
        // Normalize registry URL (remove trailing slash)
        if (this.registryUrl.endsWith('/')) {
            this.registryUrl = this.registryUrl.slice(0, -1);
        }
        
        // Helper: Get Query API base URL
        this.getQueryApiUrl = function() {
            return `${this.registryUrl}/x-nmos/query/${this.queryApiVersion}`;
        };
        
        // Helper: Get auth headers
        this.getAuthHeaders = function() {
            const headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            };
            
            if (this.credentials && this.credentials.token) {
                headers['Authorization'] = `Bearer ${this.credentials.token}`;
            } else if (this.credentials && this.credentials.username && this.credentials.password) {
                const auth = Buffer.from(
                    `${this.credentials.username}:${this.credentials.password}`
                ).toString('base64');
                headers['Authorization'] = `Basic ${auth}`;
            }
            
            return headers;
        };
    }
    
    RED.nodes.registerType("nmos-config", NMOSConfigNode, {
        credentials: {
            username: {type: "text"},
            password: {type: "password"},
            token: {type: "password"}
        }
    });
};