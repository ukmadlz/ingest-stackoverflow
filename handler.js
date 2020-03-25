'use strict';

const AWS = require('aws-sdk');
const Parser = require('rss-parser');

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
const tag = 'elk';

module.exports.ingest = async event => {
  const questionsFeed = `https://stackoverflow.com/feeds/tag?tagnames=${tag}&sort=newest`;
  
  const questionsData = await rssContent(questionsFeed);

  const completeResult = await Promise.all(questionsData.items.map(async (questionObject) => {
    const { id } = questionObject;
    const numericId = id.split('/').pop();
    const questionFeed = `https://stackoverflow.com/feeds/question/${numericId}`;
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
  }));

  const dynamoConfig = {
    region: process.env.REGION,
  }
  if(process.env.LOCAL) {
    dynamoConfig.endpoint = 'http://localhost:8000';
  }
  const DynamoDB = new AWS.DynamoDB.DocumentClient(dynamoConfig);

  await Promise.all(completeResult.map(async (questionRecord) => {
    return DynamoDB.put({
      TableName: process.env.DYNAMODB_TABLE,
      Item: questionRecord,
    }).promise();
  }));

  return {
    message: 'YUS!',
    event
  };
};
