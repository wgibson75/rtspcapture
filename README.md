# RTSP Capture CCTV System

## Introduction

This is an RTSP based CCTV system that can be run on a Raspberry Pi 4 (or later). It works with any off the shelf CCTV camera that supports RTSP and converts the video streams from each camera into HLS streams. The HLS streams can be shown natively in Safari on any Apple device e.g. a Macbook, iPhone or iPad.

The philosophy of this system is that it requires very low CPU usage on the Raspberry Pi as it is only translating (not re-encoding) the RTSP streams into HLS streams. For example, on a system with 16 high definition video cameras you can expect to use less than half the available CPU power.

The system will capture at least 3 streams from each CCTV camera:

1. A high definition live stream that is typically delayed by about 10 seconds due to HLS streaming latency
2. A high definition stream that is continuously recorded
3. A low definition stream for use in a video mosaic

All AV content is written to a USB drive that is connected to the Rasperry Pi. It is recommended to use a solid state disk as this provides blistering performance when playing back content and seeking to times.

## Installation

### Pre-requisites

The following is hardware is recommended:

* A Raspberry Pi 4 (or later)
* A micro SD card
* An external SSD drive
* Ethernet cable for connecting the Pi to your network

Where the SSD drive is concerned, it is reommended to use the biggest drive possible. A 4Tb drive will typically store 2 weeks worth or continous footage from 16 high definition CCTV cameras.

### Installation Steps

These steps are based on the Raspberry Pi 4 but they should work just as well on a Raspberry Pi 5.

Follow the steps below to install the system.

#### Step 1: Install Ubuntu Server

<ol>
<li>Download the latest Ubuntu Server image for Raspberry Pi from here:<br><a href="https://ubuntu.com/download/raspberry-pi">https://ubuntu.com/download/raspberry-pi</a>
<li>Write the image to your SD card. I recommend using Balena Etcher which can be downloaded here:<br><a href="https://etcher.balena.io](https://etcher.balena.io">https://etcher.balena.io](https://etcher.balena.io</a>
<li>Before you bootup the Pi for the first time, you need to modify the one of the configuration files on the boot partition of the SD card to setup the hostname; your username and your public SSH key for logging in over the network. Mount the SD card on your host and open the following file for editing:<br>/user-data
<li>Add the following configuration to the end of this file, where:
<ul>
<li><b>&lt;hostname&gt;
</b> should be set to the hostname of your Raspberry Pi
<li><b>&lt;username&gt;</b> should be set to your username
<li><b>&lt;ssh_authorized_keys&gt;</b> should be set to your public SSH key
</ul>

<pre>
## Set hostnamehostname: &lt;hostname&gt;
## Configure default usersystem_info:  default_user:    name: &lt;username&gt;    ssh_authorized_keys:      - &lt;your SSH key&gt;
    sudo: ALL=(ALL) NOPASSWD:ALL
</pre>

<li>Insert the SD card into your Raspberry Pi
<li>Connect the Raspberry Pi to your network using an ethernet cable and bootup Ubuntu Server for the first time.
<li>Once booted, login over SSH.
<li>In your SSH terminal, update the available packages:
<pre>sudo apt update</pre>
<li>Upgrade all installed packages:
<pre>sudo apt upgrade</pre>
<li>(optional) I suggest installing the following additional packages to make life easier later:
<pre>
sudo apt install net-tools
sudo apt install htop
</pre>
</ol>

#### Step 2: Install Docker

Follow these steps to install Docker and Docker Compose on your Raspberry Pi:
<ol>
<li>Install some prerequisites:
<pre>sudo apt install curl ca-certificates apt-transport-https software-properties-common</pre>
<li>Add the Docker GPG key:
<pre>curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg</pre>
<li>Add the Docker repository to your sources list:
<pre>echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null</pre>
<li>Update the package repository cache:
<pre>sudo apt update</pre>
<li>Install Docker community edition:
<pre>sudo apt install docker-ce -y</pre>
<li>Check the status of the Docker service (it should be running):
<pre>sudo systemctl status docker</pre>
<li>Add your user account to the Docker group:
<pre>sudo usermod -aG docker ${USER}</pre>
<li>Apply that changes by logging in and out:
<pre>sudo su - ${USER}</pre>
<li>Confirm your account is in the Docker group:
<pre>groups ${USER}</pre>
<li>Install Docker Compose:</li>
<pre>sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose</pre>
</ol>

#### Step 3: Install the RTSP Capture CCTV System

Follow these steps to install the RTSP Capture CCTV System:

TBD



