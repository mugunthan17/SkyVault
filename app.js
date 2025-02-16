const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const pg = require("pg");
const bcrypt = require("bcrypt");
const env = require("dotenv");
const fs = require('fs');
const AWS = require('aws-sdk');
const LocalStorage = require('node-localstorage').LocalStorage;
const localStorage = new LocalStorage('./scratch');
const app = express();
const port = 3000;
const saltRounds = 10;
env.config();
const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();


app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
const multer = require("multer");

const storage = multer.diskStorage({
  destination: path.join(__dirname, "/public/uploads"),
  filename: (req, file, cb) => {
    cb(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname)
    );
  },
});
AWS.config.update({
  accessKeyId: process.env.AccessKeyID,
  secretAccessKey: process.env.SecretAccessKey,
  region: process.env.region
});
const s3 = new AWS.S3();
const upload = multer({ storage });
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.get("/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "signup.html"));
});


app.get("/logout", (req,res)=>{
  res.redirect("/login");
})

app.post("/signup", async (req, res) => {
  const email = req.body.mailID;
  const password = req.body.password;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (checkResult.rows.length > 0) {
      res.send("Email already exists. Try logging in.");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.log("Error in Hashing:", err);
        }
        else {
          const result = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2)",
            [email, hash]
          );
          console.log(result);
          localStorage.setItem('email', email);
          res.sendFile(path.join(__dirname, "views", "home.html"));
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

app.post("/login", async (req, res) => {
  const email = req.body.mailID;
  const loginPassword = req.body.password;

  try {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const storedHashedPassword = user.password;
      //verifying the password
      bcrypt.compare(loginPassword, storedHashedPassword, (err, result) => {
        if (err) {
          console.error("Error comparing passwords:", err);
        } else {
          if (result) {
            res.sendFile(path.join(__dirname, "views", "home.html"));
          } else {
            res.send("Incorrect Password");
          }
        }
      });
    } else {
      res.send("User not found");
    }
  } catch (err) {
    console.log(err);
  }
});

app.post('/getFiles',async (req,res)=>{
  const email=req.body.email;
  // console.log(email);
  result = await db.query("SELECT file,originalname FROM FILES WHERE email = $1", [
    email,
  ]);
  // console.log(result);
  const filesArray=result.rows;
  const link=process.env.S3+email+"/";
  res.status(200).json({filesArray,link});
})
app.post('/delete',async (req,res)=>{
  // console.log(req);
  const file=req.body.file;
  console.log("file",file);
  const filename=file.split('/');
  console.log(filename[1]);
  const bucketName = 'skyvaultmugu';

  const params = {
    Bucket: bucketName,
    Key: file,
  };
  s3.deleteObject(params, async function(err, data) {
    if (err) {
      console.error("Error deleting file from S3:", err);
      res.status(200).json({ code: 500, message: "Error occured in deleting file" });
    } else {
      await db.query(
        "DELETE FROM files WHERE file=$1",
        [filename[1]]
    );
      res.status(200).json({ code: 200, message: "Deleted succcesfully" });
      console.log("File deleted successfully from S3");
    }
  });
})
app.post('/upload',upload.single("file"),async (req,res)=>{
  // const {file}=req.file;
  // console.log(req.file);
  const filename=req.file.filename;
  const originalname=req.body.original_name;
  // console.log(req)
  const email=req.body.email;
  const bucketName = 'skyvaultmugu';
  const key = email+'/'+filename;
  const pdfFilePath = 'public/uploads/'+filename;
  const fileContent = fs.readFileSync(pdfFilePath);
  const params = {
    Bucket: bucketName,
    Key: key,
    Body: fileContent
  };
  var result;
  // Upload the file to S3
  s3.upload(params, async (err, data) => {
    if (err) {
        console.error("Error uploading file to S3:", err);
        res.status(500).json({ code: 500, message: "Error uploading file to S3" });
    } else {
        try {
            // Assuming email and filename are defined elsewhere
            await db.query(
                "INSERT INTO files (email, file, originalname) VALUES ($1, $2,$3)",
                [email, filename, originalname]
            );
            const result = data.Location.split('/')[data.Location.split('/').length - 1];
            const link = process.env.S3 + email + "/" + result;
            console.log("File uploaded successfully to S3:", data.Location);
            // Assuming fs is imported and filename is correct
            fs.unlinkSync("public/uploads/" + filename);
            res.status(200).json({ code: 200, link: link });
        } catch (error) {
            console.error("Error inserting file into database:", error);
            res.status(500).json({ code: 500, message: "Error inserting file into database" });
        }
    }
});
  
})
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
