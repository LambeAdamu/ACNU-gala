module.exports = function (_req, res) {
  res.status(200).send("cjs-ok:" + Date.now());
};