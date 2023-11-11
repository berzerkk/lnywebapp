var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index');
});

/* GET home page. */
router.get('/terms', function(req, res, next) {
  res.render('terms');
});

router.get('/contact', function(req, res, next) {
  res.render('contact');
});


router.get('/404', function(req, res, next) {
  res.render('404');
});

module.exports = router;
