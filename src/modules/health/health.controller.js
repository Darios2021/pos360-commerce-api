module.exports = {
  health: async (req, res) => {
    res.json({
      ok: true,
      service: 'core-suite-api',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  }
};
