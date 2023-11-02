module.exports = {
    apps : [{
      name: "lns",
      script: "node ./bin/www",
      instances: "max",
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "development"
      },
      env_production: {
        NODE_ENV: "production"
      }
    }]
  };