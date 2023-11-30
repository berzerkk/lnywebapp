var express = require("express");
var router = express.Router();
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.zoho.eu",
  port: 465,
  secure: true,
  auth: {
    user: "lny.contact@zohomail.eu",
    pass: "lnycontact123",
  },
});

router.get("/", function (req, res, next) {
  res.render("index");
});

router.get("/terms", function (req, res, next) {
  res.render("terms");
});

router.get("/contact", function (req, res, next) {
  res.render("contact");
});

router.get("/approach", function (req, res, next) {
  res.render("approach");
});

router.get("/confidentiality", function (req, res, next) {
  res.render("confidentiality");
});

router.get("/404", function (req, res, next) {
  res.render("404");
});

router.post("/mail", async function (req, res, next) {
  try {
    const info = await transporter.sendMail({
      from: "lny.contact@zohomail.eu",
      to: "lny.cambridge@gmail.com",
      subject: "Nouveau contact du site languagesnsuccess.com",
      text:
        "Prenom: " +
        req.body.firstname +
        "\nNom: " +
        req.body.lastname +
        "\n Email: " +
        req.body.mail +
        "\n Telephone: " +
        req.body.phone +
        "\n Role: " +
        req.body.role,
      html:
        "Prenom: " +
        req.body.firstname +
        "<br>Nom: " +
        req.body.lastname +
        "<br> Email: " +
        req.body.mail +
        "<br> Telephone: " +
        req.body.phone +
        "<br>Role: " +
        req.body.role,
    });
    res.sendStatus(200);
  } catch (e) {
    // catch errors and send error status
    console.log(e);
    res.sendStatus(500);
  }
});

module.exports = router;
