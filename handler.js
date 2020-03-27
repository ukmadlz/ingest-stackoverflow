'use strict';

const AWS = require('aws-sdk');
const Parser = require('rss-parser');
const Logger = require('logzio-nodejs');

/**
 * Returns the value of the RSS Feed
 * @param feed URL to the RSS Feed
 * @returns Promise<Object> An object representation of the RSS
 */
const rssContent = async (feed) => {
  const parser = new Parser({
    customFields: {
      item: ['summary']
    }
  });
  return new Promise((resolve, reject) => {
    parser.parseURL(feed, (err, feed) => {
      if (err) return reject(err);
      resolve(feed);
    });
  });
}

// The SO Tag
const tags = ['elk', 'elasticsearch', 'logstash', 'kibana', 'filebeat', 'metricbeat'];

/**
 * Ingest information from StackOverflow tags
 */
module.exports.ingest = async event => {
  // Configure and instantiate DynamoDB
  const dynamoConfig = {
    region: process.env.REGION,
  }
  if(process.env.LOCAL) {
    dynamoConfig.endpoint = 'http://localhost:8000';
  }
  const DynamoDB = new AWS.DynamoDB.DocumentClient(dynamoConfig);

  // Loop through StackOverflow tags
  const questionList = await Promise.all(tags.map(async (tag) => {
    const questionsFeed = `https://stackoverflow.com/feeds/tag?tagnames=${tag}&sort=newest`;
    try {
      const questionsData = await rssContent(questionsFeed);
      return await questionsData.items;
    } catch(e) {
      console.error(e);
      return [];
    }
  }));

  // Grab all the Q&A for the listed questions
  const completeResult = await Promise.all(questionList.flat().map(async (questionObject) => {
    const { id } = questionObject;
    const numericId = id.split('/').pop();
    const questionFeed = `https://stackoverflow.com/feeds/question/${numericId}`;
    try {
      const questionData = await rssContent(questionFeed);
      const { title, summary, link, pubDate, author } = questionData.items.find((questionOrAnswer) => {
        return !questionOrAnswer.title.startsWith('Answer by ');
      });
      const theAnswers = questionData.items.filter((questionOrAnswer) => {
        return questionOrAnswer.title.startsWith('Answer by ');
      });
      return {
        title,
        summary,
        link,
        pubDate,
        author,
        answers: theAnswers
      }
    } catch(e) {
      console.error(questionFeed);
      console.error(e);
      return false;
    }
  }));

  return await Promise.all(completeResult.filter((questionRecord) => {
    return questionRecord;
  }).map(async (questionRecord) => {
    return DynamoDB.put({
      TableName: process.env.DYNAMODB_TABLE,
      Item: questionRecord,
    }).promise();
  }));
};

/**
 * Send questions and answers to logz.io
 */
module.exports.logz = async (event) => {
  const logger = Logger.createLogger({
    token: process.env.LOGZIO_TOKEN,
    type: 'lambda'
  });
  return await Promise.all(event.Records.map(async (record) => {
    return logger.log(AWS.DynamoDB.Converter.output({ M: record.dynamodb.NewImage }));
  }));
}