module.exports = {
    type: 'nmos-matrix-ui',
    component: 'NmosMatrix',
    props: {
        props: { 
            type: Object, 
            default: () => ({ registry: '' }) 
        }
    }
};
